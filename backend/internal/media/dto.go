// Package media: video và âm thanh (nhúng từ YouTube) của mục Xem, Nghe.
//
//	dto.go        kiểu dữ liệu trả ra API (JSON)
//	repository.go đọc/ghi database qua code sqlc, đổi dòng DB → DTO
//	service.go    nghiệp vụ: lọc, phân trang con trỏ, kiểm tra tham số
//	views.go      đếm lượt xem bằng Redis, worker gom về database
//	handler.go    HTTP: đọc tham số, gọi service, ghi phản hồi
package media

import (
	"time"

	"github.com/google/uuid"
)

type Channel struct {
	Slug      string `json:"slug"`
	Name      string `json:"name"`
	Verified  bool   `json:"verified"`
	Followers int64  `json:"followers_count,omitempty"`
}

// Card: một thẻ media trong danh sách (trang chủ, chuyên mục, gợi ý).
type Card struct {
	ID              uuid.UUID `json:"id"`
	Slug            string    `json:"slug"`
	Kind            string    `json:"kind"` // video | audio
	Category        string    `json:"category"`
	Title           string    `json:"title"`
	Description     string    `json:"description,omitempty"` // chỉ có ở khối nổi bật
	GroupLabel      string    `json:"group_label"`
	GenreLabel      string    `json:"genre_label"`
	YoutubeID       *string   `json:"youtube_id"`
	ThumbnailURL    string    `json:"thumbnail_url"`
	DurationSeconds *int32    `json:"duration_seconds"`
	EpisodeCount    *int32    `json:"episode_count"`
	ViewCount       int64     `json:"view_count"`
	Featured        bool      `json:"featured"`
	PublishedAt     time.Time `json:"published_at"`
	Channel         Channel   `json:"channel"`
}

// Detail: trang xem một media.
type Detail struct {
	Card
	Tags         []string `json:"tags"`
	CategoryName string   `json:"category_name"`
	LineupMonth  *string  `json:"lineup_month"` // "2026-10"
}

// Page: một trang của danh sách. NextCursor rỗng = hết.
type Page struct {
	Items      []Card `json:"items"`
	NextCursor string `json:"next_cursor,omitempty"`
}
