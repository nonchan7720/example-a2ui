// ゲートウェイ: ブラウザ(SPA)が話す唯一のサーバー。
//
//	ブラウザ ──▶ Go ゲートウェイ ──▶ エージェントランタイム(Node: CopilotKit ランタイム + Claude Agent SDK)
//
// やること:
//   - /api/copilotkit/ 以下を、エージェントランタイムへそのまま中継する(AG-UI のイベントは SSE で流れてくる)
//   - それ以外のパスには、ビルド済みの SPA(web/dist)を返す
//
// 認証やレート制限を足すなら、ここ(newHandler)に入れる。エージェントランタイムはブラウザから直接は見えない。
package main

import (
	"flag"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

func main() {
	addr := flag.String("addr", env("GATEWAY_ADDR", "127.0.0.1:8080"), "待ち受けるアドレス")
	agentURL := flag.String("agent", env("AGENT_URL", "http://127.0.0.1:8000"), "エージェントランタイムの URL")
	static := flag.String("static", env("STATIC_DIR", "../web/dist"), "SPA のビルド結果があるディレクトリ")
	flag.Parse()

	agent, err := url.Parse(*agentURL)
	if err != nil || agent.Host == "" {
		log.Fatalf("エージェントランタイムの URL が正しくありません: %q", *agentURL)
	}
	log.Printf("gateway: http://%s (agent: %s, static: %s)", *addr, agent, *static)
	log.Fatal(http.ListenAndServe(*addr, newHandler(agent, os.Getenv("AGENT_TOKEN"), *static)))
}

// newHandler は、中継と SPA の配信をまとめたハンドラーを返す。
// token が空でなければ、エージェントランタイムへのリクエストに X-Agent-Token として付ける。
func newHandler(agent *url.URL, token, static string) http.Handler {
	mux := http.NewServeMux()
	mux.Handle("/api/copilotkit/", newAgentProxy(agent, token))
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("ok")) })
	mux.Handle("/", spa(static))
	return mux
}

func newAgentProxy(agent *url.URL, token string) http.Handler {
	return &httputil.ReverseProxy{
		Rewrite: func(r *httputil.ProxyRequest) {
			r.SetURL(agent)
			r.SetXForwarded()
			// ブラウザが同じ名前のヘッダーを送ってきても、それは使わない。
			r.Out.Header.Del("X-Agent-Token")
			if token != "" {
				r.Out.Header.Set("X-Agent-Token", token)
			}
		},
		// SSE を溜めずに、届いたそばからブラウザへ流す。
		FlushInterval: -1,
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			log.Printf("agent へ中継できませんでした: %s %s: %v", r.Method, r.URL.Path, err)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadGateway)
			w.Write([]byte(`{"error":"agent runtime is unreachable"}`))
		},
	}
}

// spa は dir のファイルを返す。ファイルが無いパスには index.html を返す(SPA 側のルーティング用)。
func spa(dir string) http.Handler {
	files := http.FileServer(http.Dir(dir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") {
			http.NotFound(w, r)
			return
		}
		// http.Dir と同じ規則でパスを解決する(".." で dir の外へは出られない)。
		name := filepath.Join(dir, filepath.FromSlash(filepath.Clean("/"+r.URL.Path)))
		if info, err := os.Stat(name); err != nil || info.IsDir() {
			http.ServeFile(w, r, filepath.Join(dir, "index.html"))
			return
		}
		files.ServeHTTP(w, r)
	})
}

func env(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
