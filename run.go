package codigo

import (
	"net/http"
	"os"

	"github.com/btwiuse/codigo/product"
	"github.com/webteleport/utils"
	"github.com/webteleport/wtf"
	"tractor.dev/toolkit-go/engine/fs/osfs"
	"tractor.dev/toolkit-go/engine/fs/workingpathfs"
)

func Run(args []string) error {
	DownloadAndUnzipVSCode()

	cwd, _ := os.Getwd()
	fsys := workingpathfs.New(osfs.New(), cwd)

	wb := &Workbench{
		ProductConfiguration: product.Configuration{
			NameLong: "Codigo Editor",
		},
		FS: fsys,
	}

	var handler http.Handler = wb
	handler = utils.GzipMiddleware(wb)
	handler = utils.AllowAllCorsMiddleware(wb)
	if os.Getenv("DEBUG") != "" {
		handler = utils.GinLoggerMiddleware(wb)
	}

	return wtf.Serve(EnvRELAY(":8080"), handler)
}

func EnvRELAY(s string) string {
	if relay := os.Getenv("RELAY"); relay != "" {
		return relay
	}
	return s
}
