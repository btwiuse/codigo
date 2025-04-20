package codigo

import (
	"fmt"
	"net/http"
	"strings"
)

// getRedirectLocation makes a HEAD request to the latest release and returns the redirect location.
func getRedirectLocation(url string) (string, error) {
	client := &http.Client{
		// Prevent following redirects
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}

	resp, err := client.Head(url)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	location := resp.Header.Get("Location")
	if location == "" {
		return "", fmt.Errorf("no Location header found")
	}
	return location, nil
}

// extractVersionFromURL extracts the version tag from the redirect URL.
func extractVersionFromURL(location string) (string, error) {
	parts := strings.Split(location, "/")
	if len(parts) == 0 {
		return "", fmt.Errorf("invalid location URL")
	}
	return parts[len(parts)-1], nil
}

// buildDownloadURL constructs the final download URL from the version.
func buildDownloadURL(repo, version string) string {
	return fmt.Sprintf(
		"https://github.com/%s/releases/download/%s/vscodium-web-%s.tar.gz",
		repo, version, version,
	)
}

func getLatestReleaseURL(repo string) string {
	location, err := getRedirectLocation(fmt.Sprintf("https://github.com/%s/releases/latest", repo))
	if err != nil {
		panic(err)
	}

	version, err := extractVersionFromURL(location)
	if err != nil {
		panic(err)
	}

	downloadURL := buildDownloadURL(repo, version)
	// fmt.Println(downloadURL)
	return downloadURL
}
