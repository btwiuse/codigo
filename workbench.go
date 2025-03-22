package codigo

import (
	"context"
	"embed"
	"io"
	"io/fs"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/btwiuse/codigo/bridge"
	"github.com/btwiuse/codigo/product"
	"github.com/btwiuse/wsconn"
	"github.com/mholt/archives"
	"tractor.dev/toolkit-go/duplex/codec"
	"tractor.dev/toolkit-go/duplex/fn"
	"tractor.dev/toolkit-go/duplex/mux"
	"tractor.dev/toolkit-go/duplex/talk"
)

//go:embed assets extension
var embedded embed.FS

var archivefs fs.FS

func DownloadAndUnzipVSCode() {
	vscodeURL := os.Getenv("VSCODE_WEB_URL")
	if vscodeURL == "" {
		urlBytes, err := embedded.ReadFile("assets/vscode_url.txt")
		if err != nil {
			panic(err)
		}
		vscodeURL = strings.TrimSpace(string(urlBytes))
	}

	homeDir, err := os.UserHomeDir()
	if err != nil {
		panic(err)
	}

	vscodeArchiveFile := filepath.Base(vscodeURL)
	vscodeArchivePath := filepath.Join(homeDir, ".codigo", vscodeArchiveFile)
	vscodeExtractPath := filepath.Join(homeDir, ".codigo", "dev")
	isExtracted := false

	if _, err := os.Stat(vscodeExtractPath); !os.IsNotExist(err) {
		log.Printf("Using extracted archive %s\n", vscodeExtractPath)
		isExtracted = true
	} else if _, err := os.Stat(vscodeArchivePath); os.IsNotExist(err) {
		log.Printf("Downloading VSCODE_WEB_URL=%s to ~/.codigo\n", vscodeURL)
		resp, err := http.Get(vscodeURL)
		if err != nil {
			panic(err)
		}
		defer resp.Body.Close()

		if err := os.MkdirAll(filepath.Dir(vscodeArchivePath), 0755); err != nil {
			panic(err)
		}

		out, err := os.Create(vscodeArchivePath)
		if err != nil {
			panic(err)
		}
		defer out.Close()

		if _, err := io.Copy(out, resp.Body); err != nil {
			panic(err)
		}
	} else {
		log.Println("Using archive", vscodeArchiveFile)
	}

	if !isExtracted {
		archivefs, err = archives.FileSystem(context.Background(), vscodeArchivePath, nil)
		if err != nil {
			panic(err)
		}
	} else {
		archivefs = os.DirFS(vscodeExtractPath)
	}

	// assume ./out/ is at archive file root for tar.gz, unless
	if vscodeURL == "https://github.com/progrium/vscode-web/releases/download/v1/vscode-web-1.92.1-patched.zip" {
		archivefs, err = fs.Sub(archivefs, "dist/vscode")
		if err != nil {
			panic(err)
		}
	}
}

type BuiltinExtension = any

type GalleryExtensionInfo struct {
	ID                 string `json:"id"`
	PreRelease         bool   `json:"preRelease,omitempty"`
	MigrateStorageFrom string `json:"migrateStorageFrom,omitempty"`
}

type URIComponents struct {
	Scheme    string `json:"scheme"`
	Authority string `json:"authority,omitempty"`
	Path      string `json:"path,omitempty"`
	Query     string `json:"query,omitempty"`
	Fragment  string `json:"fragment,omitempty"`
}

type Workbench struct {
	ProductConfiguration        product.Configuration `json:"productConfiguration"`
	AdditionalBuiltinExtensions []BuiltinExtension    `json:"additionalBuiltinExtensions,omitempty"`
	FolderURI                   *URIComponents        `json:"folderUri,omitempty"`
	InitialColorTheme           ColorScheme           `json:"initialColorTheme,omitempty"`

	FS fs.FS `json:"-"`
}

func (wb *Workbench) GetFS() fs.FS {
	return wb.FS
}

type ColorScheme struct {
	ThemeType string            `json:"themeType"` // "dark" | "light" | "hcLight" | "hcDark"
	Colors    map[string]string `json:"colors,omitempty"`
}

func (wb *Workbench) setColorScheme(t string) {
	wb.InitialColorTheme.ThemeType = t
}

var VSCodigoBridge = &GalleryExtensionInfo{
	ID:         "btwiuse.codigo-bridge",
	PreRelease: true,
}

func (wb *Workbench) ensureExtension(r *http.Request) {
	origin := r.Header.Get("Origin")

	o, err := url.Parse(origin)
	if err != nil {
		log.Println(err)
		return
	}

	foundExtension := false
outerLoop:
	for i, e := range wb.AdditionalBuiltinExtensions {
		switch e := e.(type) {
		case *GalleryExtensionInfo:
			if e.ID == VSCodigoBridge.ID {
				foundExtension = true
				break outerLoop
			}
		case *URIComponents:
			if e.Path == "/extension" {
				wb.AdditionalBuiltinExtensions[i] = &URIComponents{
					Scheme:    o.Scheme,
					Authority: o.Host,
					Path:      "/extension",
				}
				foundExtension = true
				break outerLoop
			}
		}
	}

	if !foundExtension {
		wb.AdditionalBuiltinExtensions = append(wb.AdditionalBuiltinExtensions, VSCodigoBridge)
	}
}

func (wb *Workbench) ensureFolder() {
	if wb.FolderURI == nil {
		wb.FolderURI = &URIComponents{
			Scheme: "hostfs",
			Path:   "/",
		}
	}
}

func (wb *Workbench) handleBridge(w http.ResponseWriter, r *http.Request) {
	conn, err := wsconn.Wrconn(w, r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		log.Println(err)
		return
	}

	sess := mux.New(conn)
	defer sess.Close()

	peer := talk.NewPeer(sess, codec.CBORCodec{})
	peer.Handle("vscode/", fn.HandlerFrom(&bridge.Bridge{wb}))
	peer.Respond()
}

func (wb *Workbench) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// wb.setColorScheme("dark")
	wb.ensureFolder()

	mux := http.NewServeMux()

	mux.Handle("/extension/", http.FileServerFS(embedded))

	mux.Handle("/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" {
			http.ServeFileFS(w, r, embedded, "assets/index.html")
			return
		}

		if r.URL.Path == "/bridge.js" {
			http.ServeFileFS(w, r, embedded, "assets/bridge.js")
			return
		}

		if r.URL.Path == "/product.json" {
			http.ServeFileFS(w, r, embedded, "assets/product.json")
			return
		}

		if r.URL.Path == "/workbench.json" {
			http.ServeFileFS(w, r, embedded, "assets/workbench.json")
			return
		}

		http.FileServerFS(archivefs).ServeHTTP(w, r)
	}))

	mux.HandleFunc("/bridge", wb.handleBridge)

	mux.ServeHTTP(w, r)
}
