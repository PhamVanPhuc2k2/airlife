-- Truy vấn cho cmd/seed: nạp dữ liệu mẫu. "Upsert" (ON CONFLICT … DO UPDATE): chạy seed
-- nhiều lần không bị trùng, chỉ cập nhật lại nội dung.

-- name: UpsertCategory :exec
INSERT INTO categories (slug, name, icon, title, description, sort_order)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (slug) DO UPDATE
SET name = EXCLUDED.name, icon = EXCLUDED.icon, title = EXCLUDED.title,
    description = EXCLUDED.description, sort_order = EXCLUDED.sort_order;

-- name: UpsertCategoryFilter :exec
INSERT INTO category_filters (category_slug, slug, name, sort_order)
VALUES ($1, $2, $3, $4)
ON CONFLICT (category_slug, slug) DO UPDATE
SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order;

-- name: UpsertChannel :one
INSERT INTO channels (slug, name, type, verified, followers_count, description)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (slug) DO UPDATE
SET name = EXCLUDED.name, type = EXCLUDED.type, verified = EXCLUDED.verified,
    followers_count = EXCLUDED.followers_count, description = EXCLUDED.description,
    updated_at = now()
RETURNING id;

-- name: UpsertMedia :exec
INSERT INTO media (slug, kind, category_slug, channel_id, title, description, group_label,
                   genre_label, tags, youtube_id, thumbnail_url, duration_seconds,
                   episode_count, view_count, featured, lineup_month, published_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
ON CONFLICT (slug) DO UPDATE
SET kind = EXCLUDED.kind, category_slug = EXCLUDED.category_slug,
    channel_id = EXCLUDED.channel_id, title = EXCLUDED.title,
    description = EXCLUDED.description, group_label = EXCLUDED.group_label,
    genre_label = EXCLUDED.genre_label, tags = EXCLUDED.tags,
    -- Giữ youtube_id đã gắn tay nếu dữ liệu mẫu không có
    youtube_id = COALESCE(EXCLUDED.youtube_id, media.youtube_id),
    thumbnail_url = EXCLUDED.thumbnail_url, duration_seconds = EXCLUDED.duration_seconds,
    episode_count = EXCLUDED.episode_count, featured = EXCLUDED.featured,
    lineup_month = EXCLUDED.lineup_month, updated_at = now();

-- name: UpsertNewsCategory :exec
INSERT INTO news_categories (slug, name, description, sort_order)
VALUES ($1, $2, $3, $4)
ON CONFLICT (slug) DO UPDATE
SET name = EXCLUDED.name, description = EXCLUDED.description, sort_order = EXCLUDED.sort_order;

-- name: UpsertNews :exec
INSERT INTO news (slug, category_slug, title, excerpt, body_html, cover_url, author, published_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
ON CONFLICT (slug) DO UPDATE
SET category_slug = EXCLUDED.category_slug, title = EXCLUDED.title, excerpt = EXCLUDED.excerpt,
    body_html = EXCLUDED.body_html, cover_url = EXCLUDED.cover_url, author = EXCLUDED.author,
    published_at = EXCLUDED.published_at, updated_at = now();

-- Người dùng mẫu (bình luận mẫu cần người viết). Đánh dấu đã xác minh email.
-- name: UpsertSeedUser :one
INSERT INTO users (email, password_hash, display_name, email_verified_at)
VALUES ($1, $2, $3, now())
ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name
RETURNING id;

-- Bình luận mẫu có id cố định (uuid sinh từ khoá trong data.json): chạy seed lại không bị nhân đôi.
-- name: UpsertSeedComment :exec
INSERT INTO comments (id, media_id, news_id, parent_id, user_id, body, like_count, reply_count, created_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
ON CONFLICT (id) DO UPDATE
SET body = EXCLUDED.body, like_count = EXCLUDED.like_count, reply_count = EXCLUDED.reply_count;

-- name: UpsertProduct :one
INSERT INTO products (slug, kind, category_slug, tag, channel_id, name, description, body_html,
                      image_url, gallery, price, old_price, delivery_methods, rating, rating_count,
                      sold_count, published_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
ON CONFLICT (slug) DO UPDATE
SET kind = EXCLUDED.kind, category_slug = EXCLUDED.category_slug, tag = EXCLUDED.tag,
    channel_id = EXCLUDED.channel_id, name = EXCLUDED.name, description = EXCLUDED.description,
    body_html = EXCLUDED.body_html, image_url = EXCLUDED.image_url, gallery = EXCLUDED.gallery,
    price = EXCLUDED.price, old_price = EXCLUDED.old_price,
    delivery_methods = EXCLUDED.delivery_methods, rating = EXCLUDED.rating,
    rating_count = EXCLUDED.rating_count, updated_at = now()
RETURNING id;

-- Tồn kho chỉ đặt lần đầu: chạy seed lại không "nạp lại hàng" cho biến thể đã bán bớt khi thử.
-- name: UpsertProductVariant :exec
INSERT INTO product_variants (product_id, sku, label, price, old_price, stock, sort_order)
VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (sku) DO UPDATE
SET label = EXCLUDED.label, price = EXCLUDED.price, old_price = EXCLUDED.old_price,
    sort_order = EXCLUDED.sort_order;

-- name: UpsertMediaProduct :exec
INSERT INTO media_products (media_id, product_id, sort_order)
VALUES ($1, $2, $3)
ON CONFLICT (media_id, product_id) DO UPDATE SET sort_order = EXCLUDED.sort_order;
