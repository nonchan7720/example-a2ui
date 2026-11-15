package main

import (
	"bufio"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func newGateway(t *testing.T, agent http.Handler, token string) *httptest.Server {
	t.Helper()
	upstream := httptest.NewServer(agent)
	t.Cleanup(upstream.Close)
	target, _ := url.Parse(upstream.URL)

	static := t.TempDir()
	os.WriteFile(filepath.Join(static, "index.html"), []byte("<html>spa</html>"), 0o644)
	os.WriteFile(filepath.Join(static, "app.js"), []byte("console.log(1)"), 0o644)

	gateway := httptest.NewServer(newHandler(target, token, static))
	t.Cleanup(gateway.Close)
	return gateway
}

func body(t *testing.T, response *http.Response) string {
	t.Helper()
	defer response.Body.Close()
	data, _ := io.ReadAll(response.Body)
	return string(data)
}

func TestProxyForwardsPathAndToken(t *testing.T) {
	gateway := newGateway(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintf(w, "%s %s token=%s", r.Method, r.URL.Path, r.Header.Get("X-Agent-Token"))
	}), "secret")

	request, _ := http.NewRequest("POST", gateway.URL+"/api/copilotkit/agent/default/run", nil)
	request.Header.Set("X-Agent-Token", "from-browser") // ブラウザが付けた値は捨てられる
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := body(t, response), "POST /api/copilotkit/agent/default/run token=secret"; got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

// SSE のイベントが、エージェント側の応答が終わる前にブラウザへ届くこと。
func TestProxyStreamsEvents(t *testing.T) {
	release := make(chan struct{})
	gateway := newGateway(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: first\n\n")
		w.(http.Flusher).Flush()
		<-release
		fmt.Fprint(w, "data: second\n\n")
	}), "")
	defer close(release)

	response, err := http.Post(gateway.URL+"/api/copilotkit/agent/default/run", "application/json", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()

	line := make(chan string, 1)
	go func() {
		text, _ := bufio.NewReader(response.Body).ReadString('\n')
		line <- text
	}()
	select {
	case got := <-line:
		if got != "data: first\n" {
			t.Errorf("got %q", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("最初のイベントが、応答の終わりまで届かなかった")
	}
}

func TestProxyReportsUnreachableAgent(t *testing.T) {
	target, _ := url.Parse("http://127.0.0.1:1")
	gateway := httptest.NewServer(newHandler(target, "", t.TempDir()))
	defer gateway.Close()

	response, err := http.Get(gateway.URL + "/api/copilotkit/info")
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusBadGateway {
		t.Errorf("status = %d, want 502", response.StatusCode)
	}
}

func TestStaticFilesAndSpaFallback(t *testing.T) {
	gateway := newGateway(t, http.NotFoundHandler(), "")
	for path, want := range map[string]string{
		"/":                "<html>spa</html>",
		"/app.js":          "console.log(1)",
		"/some/spa/route":  "<html>spa</html>",
		"/../../etc/hosts": "<html>spa</html>",
	} {
		response, err := http.Get(gateway.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		if got := body(t, response); got != want {
			t.Errorf("GET %s = %q, want %q", path, got, want)
		}
	}
	response, _ := http.Get(gateway.URL + "/api/unknown")
	if response.StatusCode != http.StatusNotFound {
		t.Errorf("GET /api/unknown = %d, want 404", response.StatusCode)
	}
}
