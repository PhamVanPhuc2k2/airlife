package server

import (
	"context"
	"net/http"
	"time"

	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/response"
)

// healthz: tiến trình còn sống không. Không kiểm tra DB; nếu DB chết mà healthz
// báo lỗi thì Docker/K8s sẽ khởi động lại API liên tục, mà khởi động lại không chữa được DB.
func (s *Server) healthz(w http.ResponseWriter, _ *http.Request) {
	response.OK(w, map[string]string{"status": "ok"})
}

// readyz: sẵn sàng nhận request chưa, tức là kết nối được cả PostgreSQL, Redis, RabbitMQ.
// Load balancer dùng endpoint này để quyết định có chuyển request vào hay không.
func (s *Server) readyz(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()

	checks := map[string]string{"postgres": "ok", "redis": "ok", "rabbitmq": "ok"}
	ready := true

	if err := s.deps.DB.Ping(ctx); err != nil {
		checks["postgres"] = "lỗi"
		ready = false
	}
	if err := s.deps.Redis.Ping(ctx).Err(); err != nil {
		checks["redis"] = "lỗi"
		ready = false
	}
	if s.deps.RabbitMQ.IsClosed() {
		checks["rabbitmq"] = "lỗi"
		ready = false
	}

	status := http.StatusOK
	if !ready {
		status = http.StatusServiceUnavailable
	}
	// Không trả chi tiết lỗi (địa chỉ, tên host) ra ngoài; chỉ ok / lỗi.
	response.JSON(w, status, checks)
}
