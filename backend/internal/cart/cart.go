// Package cart: giỏ hàng.
//
// Người đã đăng nhập: giỏ lưu ở bảng cart_items. Khách chưa đăng nhập: giỏ nằm trong trình duyệt
// (chỉ id biến thể và số lượng); Preview trả thông tin hiện tại để hiện, và Merge gộp vào giỏ
// trên server khi khách đăng nhập. Giá, tồn kho LUÔN lấy từ database, không tin số client gửi.
package cart

import (
	"context"
	"slices"

	"github.com/google/uuid"

	"github.com/PhamVanPhuc2k2/airlife/backend/internal/db"
	"github.com/PhamVanPhuc2k2/airlife/backend/pkg/apperr"
)

const (
	MaxLines    = 50 // dòng / giỏ
	MaxQuantity = 99 // mỗi dòng
)

var (
	errVariantNotFound = apperr.NotFound("variant_not_found", "Sản phẩm này không còn bán")
	errCartFull        = apperr.Conflict("cart_full", "Giỏ hàng đã đủ 50 sản phẩm")
	errQuantity        = apperr.Invalid("invalid_quantity", "Số lượng từ 1 đến 99")
)

// Vấn đề của một dòng giỏ: phải xử lý trước khi đặt hàng
const (
	ProblemUnavailable = "unavailable"  // sản phẩm ẩn / biến thể ngừng bán
	ProblemOutOfStock  = "out_of_stock" // hết hàng
	ProblemLowStock    = "low_stock"    // còn ít hơn số lượng trong giỏ
)

type Line struct {
	VariantID       uuid.UUID `json:"variant_id"`
	Quantity        int32     `json:"quantity"`
	Label           string    `json:"label"`
	Price           int64     `json:"price"`
	OldPrice        *int64    `json:"old_price"`
	Stock           int32     `json:"stock"`
	Product         Product   `json:"product"`
	DeliveryMethods []string  `json:"delivery_methods"`
	Problem         string    `json:"problem,omitempty"`
}

type Product struct {
	Slug        string `json:"slug"`
	Name        string `json:"name"`
	ImageURL    string `json:"image_url"`
	ChannelName string `json:"channel_name"`
}

type Cart struct {
	Lines    []Line `json:"lines"`
	Count    int32  `json:"count"`    // tổng số món (huy hiệu trên icon giỏ)
	Subtotal int64  `json:"subtotal"` // chỉ tính dòng không có vấn đề
	// Cách nhận hàng dùng được cho CẢ giỏ (giao của các dòng). Rỗng mà giỏ có hàng: các món không
	// có cách nhận chung (vd. nước hoa chỉ nhận ở cửa ra máy bay + cà phê chỉ giao sân bay đến/tận
	// nhà), khách phải đặt thành hai đơn.
	DeliveryMethods []string `json:"delivery_methods"`
	// Ready: đặt hàng được (có hàng, không dòng nào có vấn đề, có cách nhận chung)
	Ready bool `json:"ready"`
}

// Item: một dòng giỏ do client gửi (giỏ của khách, gộp giỏ)
type Item struct {
	VariantID uuid.UUID `json:"variant_id"`
	Quantity  int32     `json:"quantity"`
}

type Service struct {
	q *db.Queries
}

func NewService(q *db.Queries) *Service {
	return &Service{q: q}
}

// Get: giỏ của người đã đăng nhập. q truyền vào để order dùng lại trong transaction của nó.
func Get(ctx context.Context, q *db.Queries, userID uuid.UUID) (Cart, error) {
	rows, err := q.ListCartLines(ctx, userID)
	if err != nil {
		return Cart{}, err
	}
	lines := make([]Line, 0, len(rows))
	for _, r := range rows {
		lines = append(lines, Line{
			VariantID: r.VariantID, Quantity: r.Quantity, Label: r.Label, Price: r.Price,
			OldPrice: r.OldPrice, Stock: r.Stock, DeliveryMethods: r.DeliveryMethods,
			Product: Product{Slug: r.Slug, Name: r.Name, ImageURL: r.ImageUrl, ChannelName: r.ChannelName},
			Problem: problem(r.Available, r.Stock, r.Quantity),
		})
	}
	return summarize(lines), nil
}

func (s *Service) Get(ctx context.Context, userID uuid.UUID) (Cart, error) {
	return Get(ctx, s.q, userID)
}

// Preview: giỏ của khách chưa đăng nhập. Biến thể không còn tồn tại thì bỏ qua.
func (s *Service) Preview(ctx context.Context, items []Item) (Cart, error) {
	items, err := normalize(items)
	if err != nil {
		return Cart{}, err
	}
	ids := make([]uuid.UUID, len(items))
	for i, it := range items {
		ids[i] = it.VariantID
	}
	rows, err := s.q.GetVariantsForCart(ctx, ids)
	if err != nil {
		return Cart{}, err
	}
	byID := make(map[uuid.UUID]db.GetVariantsForCartRow, len(rows))
	for _, r := range rows {
		byID[r.VariantID] = r
	}
	lines := make([]Line, 0, len(items))
	for _, it := range items { // giữ thứ tự của client
		r, ok := byID[it.VariantID]
		if !ok {
			continue
		}
		lines = append(lines, Line{
			VariantID: r.VariantID, Quantity: it.Quantity, Label: r.Label, Price: r.Price,
			OldPrice: r.OldPrice, Stock: r.Stock, DeliveryMethods: r.DeliveryMethods,
			Product: Product{Slug: r.Slug, Name: r.Name, ImageURL: r.ImageUrl, ChannelName: r.ChannelName},
			Problem: problem(r.Available, r.Stock, it.Quantity),
		})
	}
	return summarize(lines), nil
}

// Set đặt số lượng một dòng (thêm mới nếu chưa có).
func (s *Service) Set(ctx context.Context, userID, variantID uuid.UUID, qty int32) (Cart, error) {
	if qty < 1 || qty > MaxQuantity {
		return Cart{}, errQuantity
	}
	n, err := s.q.CountCartLines(ctx, userID)
	if err != nil {
		return Cart{}, err
	}
	// Giỏ đầy vẫn cho đổi số lượng dòng đã có; SetCartItem bên dưới là upsert nên chỉ chặn khi
	// đây là dòng mới (kiểm tra gần đúng: đếm rồi thêm, đủ để chặn lạm dụng)
	if n >= MaxLines {
		cart, err := s.Get(ctx, userID)
		if err != nil {
			return Cart{}, err
		}
		if !slices.ContainsFunc(cart.Lines, func(l Line) bool { return l.VariantID == variantID }) {
			return Cart{}, errCartFull
		}
	}
	changed, err := s.q.SetCartItem(ctx, db.SetCartItemParams{UserID: userID, VariantID: variantID, Quantity: qty})
	if err != nil {
		return Cart{}, err
	}
	if changed == 0 {
		return Cart{}, errVariantNotFound
	}
	return s.Get(ctx, userID)
}

func (s *Service) Remove(ctx context.Context, userID, variantID uuid.UUID) (Cart, error) {
	if err := s.q.DeleteCartItem(ctx, db.DeleteCartItemParams{UserID: userID, VariantID: variantID}); err != nil {
		return Cart{}, err
	}
	return s.Get(ctx, userID)
}

// Merge gộp giỏ của khách vào giỏ trên server (lấy số lượng lớn hơn, xem cart.sql).
func (s *Service) Merge(ctx context.Context, userID uuid.UUID, items []Item) (Cart, error) {
	items, err := normalize(items)
	if err != nil {
		return Cart{}, err
	}
	for _, it := range items {
		if err := s.q.MergeCartItem(ctx, db.MergeCartItemParams{
			UserID: userID, VariantID: it.VariantID, Quantity: it.Quantity,
		}); err != nil {
			return Cart{}, err
		}
	}
	return s.Get(ctx, userID)
}

// normalize: gộp dòng trùng, kẹp số lượng, giới hạn số dòng.
func normalize(items []Item) ([]Item, error) {
	if len(items) > MaxLines {
		return nil, errCartFull
	}
	out := make([]Item, 0, len(items))
	seen := make(map[uuid.UUID]int, len(items))
	for _, it := range items {
		q := min(max(it.Quantity, 1), MaxQuantity)
		if i, ok := seen[it.VariantID]; ok {
			out[i].Quantity = min(out[i].Quantity+q, MaxQuantity)
			continue
		}
		seen[it.VariantID] = len(out)
		out = append(out, Item{VariantID: it.VariantID, Quantity: q})
	}
	return out, nil
}

func problem(available bool, stock, qty int32) string {
	switch {
	case !available:
		return ProblemUnavailable
	case stock == 0:
		return ProblemOutOfStock
	case stock < qty:
		return ProblemLowStock
	}
	return ""
}

func summarize(lines []Line) Cart {
	c := Cart{Lines: lines, DeliveryMethods: []string{}}
	ok := len(lines) > 0
	first := true
	for _, l := range lines {
		c.Count += l.Quantity
		if l.Problem != "" {
			ok = false
			continue
		}
		c.Subtotal += l.Price * int64(l.Quantity)
		if first {
			c.DeliveryMethods = slices.Clone(l.DeliveryMethods)
			first = false
		} else {
			c.DeliveryMethods = slices.DeleteFunc(c.DeliveryMethods, func(m string) bool {
				return !slices.Contains(l.DeliveryMethods, m)
			})
		}
	}
	c.Ready = ok && len(c.DeliveryMethods) > 0
	return c
}
