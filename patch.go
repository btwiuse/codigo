package codigo

import (
	"bytes"
	"io"
	"net/http"
	"regexp"
)

// StripWorkerBlockedCalls creates middleware that removes specific blocked function calls
// from the extensionHostWorker.js file
func StripWorkerBlockedCalls(next http.Handler) http.Handler {
	// Compile the regex patterns we want to remove
	patterns := []*regexp.Regexp{
		regexp.MustCompile(`'sha256-[a-zA-Z0-9+/=]+'`),
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/out/vs/workbench/services/extensions/worker/webWorkerExtensionHostIframe.html" {
			next.ServeHTTP(w, r)
			return
		}
		println("patching html")

		// Create a response recorder to capture the original response
		rec := &responseRecorder{
			ResponseWriter: w,
			body:           &bytes.Buffer{},
		}

		// Call the next handler
		next.ServeHTTP(rec, r)

		// Get the response body
		content := rec.body.String()

		// Apply all regex patterns to remove blocked calls
		for _, pattern := range patterns {
			content = pattern.ReplaceAllString(content, `'sha256-c8thgD+1oN4/vlEAklpmXmsovnj5avm4D6O+BpUcKdU='`)
		}

		// Write the modified headers
		for k, v := range rec.header {
			w.Header()[k] = v
		}

		// Write the status code and modified content
		w.WriteHeader(rec.status)
		io.WriteString(w, content)
	})
}

// responseRecorder is a custom ResponseWriter that records the response
type responseRecorder struct {
	http.ResponseWriter
	status int
	body   *bytes.Buffer
	header http.Header
}

func (r *responseRecorder) WriteHeader(status int) {
	r.status = status
}

func (r *responseRecorder) Write(b []byte) (int, error) {
	return r.body.Write(b)
}

func (r *responseRecorder) Header() http.Header {
	if r.header == nil {
		r.header = make(http.Header)
	}
	return r.header
}
