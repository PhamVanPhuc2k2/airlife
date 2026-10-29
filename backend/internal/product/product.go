// Package product: danh mục sản phẩm (Kinh doanh, Tour bay), trang sản phẩm, sản phẩm trong video,
// yêu thích.
//
// Hai loại sản phẩm:
//   - goods (hàng hoá: miễn thuế, đặc sản, mua sắm, dịch vụ sân bay): có biến thể, cho vào giỏ.
//   - booking (vé bay, tour): hiện trong danh mục; đặt chỗ theo ngày, số khách làm ở Phần 08.
package product

import (
	"context"
	"errors"
	"regexp"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/PhamVanPhuc2k2/airlife/backend/internal/db"
	"github.com/PhamVanPhuc2k2/airlife/backend/internal/media"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/apperr"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/pagination"
)

const (
	defaultLimit = 24
	maxLimit     = 48
)

var (
	slugRe      = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)
	errNotFound = apperr.NotFound("product_not_found", "Không tìm thấy sản phẩm")
)

type Channel struct {
	Slug      string `json:"slug"`
	Name      string `json:"name"`
	Verified  bool   `json:"verified"`
	Type      string `json:"type,omitempty"`
	Followers int64  `json:"followers_count,omitempty"`
}

// Card: một sản phẩm trong lưới. Price là giá thấp nhất ("từ …").
type Card struct {
	ID          uuid.UUID `json:"id"`
	Slug        string    `json:"slug"`
	Kind        string    `json:"kind"` // goods | booking
	Category    string    `json:"category"`
	Tag         string    `json:"tag"`
	TagName     string    `json:"tag_name"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	ImageURL    string    `json:"image_url"`
	Price       int64     `json:"price"`
	OldPrice    *int64    `json:"old_price"`
	Rating      float64   `json:"rating"`
	RatingCount int32     `json:"rating_count"`
	Sold        int32     `json:"sold_count"`
	PublishedAt time.Time `json:"published_at"`
	Channel     Channel   `json:"channel"`
}

type Variant struct {
	ID       uuid.UUID `json:"id"`
	Label    string    `json:"label"`
	Price    int64     `json:"price"`
	OldPrice *int64    `json:"old_price"`
	Stock    int32     `json:"stock"`
}

type Detail struct {
	Card
	CategoryName    string       `json:"category_name"`
	BodyHTML        string       `json:"body_html"` // đã lọc bằng bluemonday khi ghi
	Gallery         []string     `json:"gallery"`
	DeliveryMethods []string     `json:"delivery_methods"`
	Variants        []Variant    `json:"variants"` // rỗng với vé, tour (Phần 08)
	Media           []media.Card `json:"media"`    // video có sản phẩm này
	Related         []Card       `json:"related"`
}

type Page struct {
	Items      []Card `json:"items"`
	NextCursor string `json:"next_cursor,omitempty"`
}

type ListParams struct {
	Category string // kinh-doanh | tour-bay; "" = tất cả
	Tag      string // chip lọc
	Channel  string // gian hàng của một kênh
	Sort     string // new (mặc định) | bestseller
	Cursor   string
	Limit    int
}

type cursorNew struct {
	T  time.Time `json:"t"`
	ID uuid.UUID `json:"id"`
}

type cursorSold struct {
	Sold int32     `json:"s"`
	ID   uuid.UUID `json:"id"`
}

type Service struct {
	q *db.Queries
}

func NewService(q *db.Queries) *Service {
	return &Service{q: q}
}

// toCard: mọi truy vấn danh sách chọn cùng bộ cột (xem products.sql), nên các kiểu ...Row đổi
// thẳng sang ListProductsNewRow được.
func toCard(r db.ListProductsNewRow) Card {
	return Card{
		ID: r.ID, Slug: r.Slug, Kind: r.Kind, Category: r.CategorySlug, Tag: r.Tag, TagName: r.TagName,
		Name: r.Name, Description: r.Description, ImageURL: r.ImageUrl, Price: r.Price, OldPrice: r.OldPrice,
		Rating: r.Rating, RatingCount: r.RatingCount, Sold: r.SoldCount, PublishedAt: r.PublishedAt,
		Channel: Channel{Slug: r.ChannelSlug, Name: r.ChannelName, Verified: r.ChannelVerified},
	}
}

func optional(s string) (*string, error) {
	if s == "" {
		return nil, nil
	}
	if !slugRe.MatchString(s) {
		return nil, apperr.Invalid("invalid_filter", "Bộ lọc không hợp lệ")
	}
	return &s, nil
}

func (s *Service) List(ctx context.Context, p ListParams) (Page, error) {
	limit := p.Limit
	if limit <= 0 || limit > maxLimit {
		limit = defaultLimit
	}
	category, err := optional(p.Category)
	if err != nil {
		return Page{}, err
	}
	tag, err := optional(p.Tag)
	if err != nil {
		return Page{}, err
	}
	channel, err := optional(p.Channel)
	if err != nil {
		return Page{}, err
	}

	// Lấy limit+1 dòng để biết còn trang sau không
	var cards []Card
	switch p.Sort {
	case "", "new":
		var c cursorNew
		has, err := pagination.Decode(p.Cursor, &c)
		if err != nil {
			return Page{}, err
		}
		arg := db.ListProductsNewParams{Category: category, Tag: tag, Channel: channel, Limit: int32(limit + 1)} //nolint:gosec // limit ≤ 48
		if has {
			arg.CursorTime, arg.CursorID = &c.T, &c.ID
		}
		rows, err := s.q.ListProductsNew(ctx, arg)
		if err != nil {
			return Page{}, err
		}
		for _, r := range rows {
			cards = append(cards, toCard(r))
		}
	case "bestseller":
		var c cursorSold
		has, err := pagination.Decode(p.Cursor, &c)
		if err != nil {
			return Page{}, err
		}
		arg := db.ListProductsBestsellerParams{Category: category, Tag: tag, Channel: channel, Limit: int32(limit + 1)} //nolint:gosec // như trên
		if has {
			arg.CursorSold, arg.CursorID = &c.Sold, &c.ID
		}
		rows, err := s.q.ListProductsBestseller(ctx, arg)
		if err != nil {
			return Page{}, err
		}
		for _, r := range rows {
			cards = append(cards, toCard(db.ListProductsNewRow(r)))
		}
	default:
		return Page{}, apperr.Invalid("invalid_sort", "Cách sắp xếp không hợp lệ")
	}

	page := Page{Items: cards}
	if page.Items == nil {
		page.Items = []Card{}
	}
	if len(cards) > limit {
		page.Items = cards[:limit]
		last := cards[limit-1]
		if p.Sort == "bestseller" {
			page.NextCursor = pagination.Encode(cursorSold{Sold: last.Sold, ID: last.ID})
		} else {
			page.NextCursor = pagination.Encode(cursorNew{T: last.PublishedAt, ID: last.ID})
		}
	}
	return page, nil
}

func (s *Service) Get(ctx context.Context, slug string) (Detail, error) {
	if !slugRe.MatchString(slug) {
		return Detail{}, errNotFound
	}
	r, err := s.q.GetProductBySlug(ctx, slug)
	if errors.Is(err, pgx.ErrNoRows) {
		return Detail{}, errNotFound
	}
	if err != nil {
		return Detail{}, err
	}
	d := Detail{
		Card: Card{
			ID: r.ID, Slug: r.Slug, Kind: r.Kind, Category: r.CategorySlug, Tag: r.Tag, TagName: r.TagName,
			Name: r.Name, Description: r.Description, ImageURL: r.ImageUrl, Price: r.Price, OldPrice: r.OldPrice,
			Rating: r.Rating, RatingCount: r.RatingCount, Sold: r.SoldCount, PublishedAt: r.PublishedAt,
			Channel: Channel{
				Slug: r.ChannelSlug, Name: r.ChannelName, Verified: r.ChannelVerified,
				Type: r.ChannelType, Followers: r.ChannelFollowers,
			},
		},
		CategoryName: r.CategoryName, BodyHTML: r.BodyHtml, Gallery: r.Gallery,
		DeliveryMethods: r.DeliveryMethods,
	}

	variants, err := s.q.ListProductVariants(ctx, r.ID)
	if err != nil {
		return Detail{}, err
	}
	d.Variants = make([]Variant, 0, len(variants))
	for _, v := range variants {
		d.Variants = append(d.Variants, Variant(v))
	}

	mediaRows, err := s.q.ListProductMedia(ctx, r.ID)
	if err != nil {
		return Detail{}, err
	}
	d.Media = make([]media.Card, 0, len(mediaRows))
	for _, m := range mediaRows {
		d.Media = append(d.Media, media.CardOf(m.Medium, m.Channel))
	}

	related, err := s.q.ListRelatedProducts(ctx, db.ListRelatedProductsParams{
		Category: r.CategorySlug, Tag: r.Tag, ExcludeID: r.ID, Limit: 4,
	})
	if err != nil {
		return Detail{}, err
	}
	d.Related = make([]Card, 0, len(related))
	for _, x := range related {
		d.Related = append(d.Related, toCard(db.ListProductsNewRow(x)))
	}
	return d, nil
}

// ByMedia: sản phẩm gắn trong một video (trang xem).
func (s *Service) ByMedia(ctx context.Context, mediaSlug string) ([]Card, error) {
	if !slugRe.MatchString(mediaSlug) {
		return []Card{}, nil
	}
	rows, err := s.q.ListMediaProducts(ctx, mediaSlug)
	if err != nil {
		return nil, err
	}
	out := make([]Card, 0, len(rows))
	for _, r := range rows {
		out = append(out, toCard(db.ListProductsNewRow(r)))
	}
	return out, nil
}

// TopSelling: khối "Kinh doanh" ở trang chủ.
func (s *Service) TopSelling(ctx context.Context, category string, n int) ([]Card, error) {
	p, err := s.List(ctx, ListParams{Category: category, Sort: "bestseller", Limit: n})
	return p.Items, err
}

// Yêu thích ----------------------------------------------------------------------------------

func (s *Service) SetFavorite(ctx context.Context, userID uuid.UUID, slug string, fav bool) error {
	if !slugRe.MatchString(slug) {
		return errNotFound
	}
	if !fav {
		return s.q.RemoveFavorite(ctx, db.RemoveFavoriteParams{UserID: userID, Slug: slug})
	}
	n, err := s.q.AddFavorite(ctx, db.AddFavoriteParams{UserID: userID, Slug: slug})
	if err != nil || n == 1 {
		return err
	}
	// 0 dòng: đã thích từ trước, hoặc sản phẩm không tồn tại
	if _, err := s.q.GetProductIDBySlug(ctx, slug); errors.Is(err, pgx.ErrNoRows) {
		return errNotFound
	} else if err != nil {
		return err
	}
	return nil
}

func (s *Service) IsFavorite(ctx context.Context, userID uuid.UUID, slug string) (bool, error) {
	return s.q.IsFavorite(ctx, db.IsFavoriteParams{UserID: userID, Slug: slug})
}

func (s *Service) Favorites(ctx context.Context, userID uuid.UUID, cursorStr string) (Page, error) {
	var c cursorNew
	has, err := pagination.Decode(cursorStr, &c)
	if err != nil {
		return Page{}, err
	}
	arg := db.ListFavoritesParams{UserID: userID, Limit: defaultLimit + 1}
	if has {
		arg.CursorTime, arg.CursorID = &c.T, &c.ID
	}
	rows, err := s.q.ListFavorites(ctx, arg)
	if err != nil {
		return Page{}, err
	}
	page := Page{Items: make([]Card, 0, len(rows))}
	for i, r := range rows {
		if i == defaultLimit {
			last := rows[defaultLimit-1]
			page.NextCursor = pagination.Encode(cursorNew{T: last.FavoritedAt, ID: last.ID})
			break
		}
		page.Items = append(page.Items, Card{
			ID: r.ID, Slug: r.Slug, Kind: r.Kind, Category: r.CategorySlug, Tag: r.Tag, TagName: r.TagName,
			Name: r.Name, Description: r.Description, ImageURL: r.ImageUrl, Price: r.Price, OldPrice: r.OldPrice,
			Rating: r.Rating, RatingCount: r.RatingCount, Sold: r.SoldCount, PublishedAt: r.PublishedAt,
			Channel: Channel{Slug: r.ChannelSlug, Name: r.ChannelName, Verified: r.ChannelVerified},
		})
	}
	return page, nil
}
