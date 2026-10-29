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
