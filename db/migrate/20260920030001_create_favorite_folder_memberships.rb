# frozen_string_literal: true

class CreateFavoriteFolderMemberships < ActiveRecord::Migration[8.1]
  def change
    # A sidecar table, deliberately: folder membership is opt-in organizational metadata
    # for a small subset of a user's favorites, not a property of every favorite. Keeping
    # it in its own table means filing something into a folder adds no column, index, or
    # backfill to favorites, and every read of favorites (the flat listing, /favorites.json,
    # non-owner browsing) stays exactly as cheap as it always was, regardless of how
    # heavily folders end up being used. The one exception, spelled out below at the
    # favorite_id FK, is DELETEs from favorites: those do pick up a small, measured,
    # per-row cost from this table's ON DELETE CASCADE constraint trigger.
    create_table :favorite_folder_memberships do |t|
      t.integer  :user_id, null: false
      t.bigint   :folder_id, null: false
      t.bigint   :favorite_id, null: false
      t.integer  :post_id, null: false
      # Denormalized copy of favorites.created_at, captured at filing time. Lets folder
      # pages sort/paginate by "when the post was originally favorited" using only this
      # small table - never touching favorites just to order or count a folder's contents.
      t.datetime :favorite_created_at, null: false
      t.timestamps
    end

    add_foreign_key :favorite_folder_memberships, :users, column: :user_id
    add_foreign_key :favorite_folder_memberships, :favorite_folders, column: :folder_id
    # ON DELETE CASCADE, deliberately kept over an app-level cleanup alternative:
    #
    # Reliability: unfavoriting a post happens from at least 5 call sites (FavoriteManager
    # .remove!, Post#remove_from_favorites, FlushFavoritesJob, and two in
    # TransferFavoritesJob). 4 of those 5 use Favorite.where(...).delete_all, which - unlike
    # destroy/destroy_all - bypasses ActiveRecord callbacks entirely. An after_destroy
    # callback on Favorite would silently miss all 4 of them, so "reliable cleanup without
    # the FK" would mean manually adding a matching FavoriteFolderMembership delete at every
    # current AND future Favorite-deletion call site - exactly the class of easy-to-forget
    # bug a FK exists to prevent (this migration's own first draft already missed
    # TransferFavoritesJob's two sites, which is the point).
    #
    # Cost: this FK does add real, measured overhead to DELETEs from favorites (never to
    # reads/writes-that-aren't-deletes) - it is NOT free, and claiming favorites is fully
    # "untouched" would be inaccurate. Benchmarked via EXPLAIN (ANALYZE, BUFFERS) against a
    # synthetic 20,000-row favorites batch (10% carrying a membership row, mirroring light
    # folder-feature adoption): deleting 10,000 rows took 168.7ms with this FK in place, of
    # which the constraint trigger itself accounted for 142.8ms (~85% of total, ~14us/row);
    # the same delete with the FK removed took 19.3ms. That overhead scales only with the
    # number of rows actually deleted from favorites and with favorite_folder_memberships'
    # own (small) index size - never with favorites' total row count, since the cascade
    # locates child rows via this table's own favorite_id index, not a scan of favorites.
    # It lands on already-background/batch paths (FlushFavoritesJob, TransferFavoritesJob),
    # not on any user-facing read.
    #
    # Net: given 4/5 deletion sites bypass callbacks, the reliability case for the FK
    # outweighs its bounded, non-scaling, delete-path-only cost.
    add_foreign_key :favorite_folder_memberships, :favorites, column: :favorite_id, on_delete: :cascade

    # One Favorite can be filed into at most one folder. Also serves as the lookup index
    # for point moves/removals by favorite_id (move!, unfiling back to All Favorites).
    add_index :favorite_folder_memberships, :favorite_id,
              unique: true,
              name: "index_favorite_folder_memberships_on_favorite_id"

    # Folder-page listing/count, numbered-pagination mode: ORDER BY favorite_created_at.
    add_index :favorite_folder_memberships, %i[user_id folder_id favorite_created_at],
              name: "index_favorite_folder_memberships_on_user_folder_created_at"

    # Folder-page listing, sequential (a/b cursor) pagination mode: ORDER BY id, mirroring
    # why (user_id, id) exists on favorites itself (20260827214903) - Danbooru::Paginator's
    # sequential mode always keys off the queried table's own id column.
    add_index :favorite_folder_memberships, %i[user_id folder_id id],
              name: "index_favorite_folder_memberships_on_user_folder_id"
  end
end
