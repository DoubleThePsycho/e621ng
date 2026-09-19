# frozen_string_literal: true

module PostSets
  class Favorites < PostSets::Base
    attr_reader :page, :limit

    def initialize(user, page, limit:, post_count: nil, folder_scoped: false, folder: nil) # rubocop:disable Metrics/ParameterLists
      super()
      @user = user
      @page = page
      @limit = limit
      @post_count = post_count
      @folder_scoped = folder_scoped
      @folder = folder
    end

    def tag_string
      "fav:#{@user.name}"
    end

    def current_page
      [page.to_i, 1].max
    end

    def folder_scoped?
      @folder_scoped
    end

    # Folder membership is opt-in, sidecar metadata - it must never change what "All
    # Favorites" shows. This is the exact same flat query used before the folders feature
    # existed, reused as-is both when not folder-scoped at all, and when folder-scoped but
    # sitting at the root of the folder tree (@folder.nil?): root is "All Favorites," not
    # "unfiled favorites," so browsing the folder tree at root shows every favorite, with
    # any root-level folder cards rendered above the (unfiltered) list.
    def posts
      return folder_membership_posts if folder_scoped? && @folder.present?
      legacy_flat_posts
    end

    # Direct child folders of the current folder (or root-level folders if @folder is
    # nil), sorted case-insensitively alphabetically with id as a stable tiebreaker.
    # Non-recursive: only ever queries a single parent_id level.
    def child_folders
      return [] unless folder_scoped?
      @child_folders ||= ::FavoriteFolder.where(user_id: @user.id, parent_id: @folder&.id).order(Arel.sql("lower(name) asc"), :id)
    end

    # The folder_id to navigate to if "Go Up" is clicked: nil means root. Returns the
    # sentinel :none when not inside any folder at all (i.e. already at root), since nil
    # is separately meaningful ("this folder's parent is root") and must be distinguished
    # from "there is no Go Up target to render".
    def go_up_target
      return :none if @folder.nil?
      @folder.parent_id
    end

    def empty_for_display?
      return posts.empty? unless folder_scoped?
      posts.empty? && child_folders.empty?
    end

    def has_explicit?
      !CurrentUser.safe_mode?
    end

    def hidden_posts
      @hidden_posts ||= posts.reject(&:visible?)
    end

    def login_blocked_posts
      @login_blocked_posts ||= posts.select(&:loginblocked?)
    end

    def safe_posts
      @safe_posts ||= posts.select { |p| p.safeblocked? && !p.deleteblocked? }
    end

    def api_posts
      result = posts
      fill_children(result)
      fill_tag_types(result)
      result
    end

    def tag_array
      []
    end

    def presenter
      ::PostSetPresenters::Post.new(self)
    end

    def is_random?
      false
    end

    private

    # The base Favorites query, byte-identical to how it worked before folders existed:
    # no join, no anti-join, no NOT EXISTS, no folder predicate of any kind. This is what
    # keeps `/favorites`, `/favorites.json`, and any other user's favorites page entirely
    # unaware that folder membership exists as a concept.
    def legacy_flat_posts
      @post_count ||= ::Post.tag_match("fav:#{@user.name} status:any").count_only
      @posts ||= begin # rubocop:disable Naming/MemoizedInstanceVariableName -- shared memo backing the public `posts` method for both code paths
        favs = ::Favorite.for_user(@user.id)
                         .includes(post: :uploader)
                         .order(created_at: :desc)
                         .paginate_posts(page, total_count: @post_count, limit: @limit)
        new_opts = { pagination_mode: :numbered, records_per_page: favs.records_per_page, total_count: @post_count, current_page: current_page }
        ::Danbooru::Paginator::PaginatedArray.new(favs.map(&:post), new_opts)
      end
    end

    # Folder pages are numbered-pagination-only, deliberately - see folder_max_numbered_pages.
    # Paginates from the sidecar membership table only - never touches favorites for
    # sorting, counting, or paging. favorite_created_at (a denormalized copy captured at
    # filing time) preserves "newest original favorite first" ordering without a join.
    # Posts are then fetched in a separate batch lookup and reordered in Ruby, rather than
    # joining memberships to posts, so this query's shape/cost never depends on anything
    # about `favorites` or `posts` beyond the ids this small table already stored.
    def folder_membership_posts
      @posts ||= begin # rubocop:disable Naming/MemoizedInstanceVariableName -- shared memo backing the public `posts` method for both code paths
        scope = ::FavoriteFolderMembership.where(user_id: @user.id, folder_id: @folder.id)
        count = @post_count ||= scope.count

        # Reuse Danbooru::Paginator's own page/limit parsing and validation (the same
        # "Invalid page number" / "cannot go beyond page X" / "Invalid limit" errors every
        # other paginated listing raises) via the same extending(...) mechanism
        # ApplicationRecord#paginate_posts itself uses - but never execute the relation it
        # builds; only its parsed metadata (current_page, pagination_mode, records_per_page)
        # is read. Folder pages never honor "aXX"/"bXX" cursor-mode page params - see the
        # explicit mode check below - so no relation this call could build is ever used.
        parsed = scope.extending(::Danbooru::Paginator::ActiveRecordExtension)
        parsed.paginate_posts(page, total_count: count, limit: @limit)

        # Folder pages are numbered-only by design (see folder_max_numbered_pages below): a
        # cursor-mode token can only reach here via a hand-crafted URL, since
        # folder_max_numbered_pages keeps PaginatorComponent from ever generating one.
        # Rejecting it outright - rather than translating it - is the point: this table's
        # id reflects *filing* time, not favorite time (a favorite can be filed into a
        # folder long after, or before, other filings), so id order has no reliable
        # relationship to favorite_created_at order, and any translation back to a numbered
        # position would need a COUNT scaling with the token's depth in the folder - exactly
        # the unbounded-cost shortcut this design avoids. A stale/foreign token is invalid
        # input, not "page 1"; it fails loudly like any other bad pagination param.
        unless parsed.pagination_mode == :numbered
          raise ::Danbooru::Paginator::PaginationError, "Invalid page number."
        end

        records_per_page = parsed.records_per_page
        current_page = parsed.current_page
        offset = (current_page - 1) * records_per_page

        memberships = scope.order(favorite_created_at: :desc, favorite_id: :desc)
                           .offset(offset).limit(records_per_page)

        post_ids = memberships.map(&:post_id)
        posts_by_id = ::Post.includes(:uploader).where(id: post_ids).index_by(&:id)
        ordered_posts = post_ids.filter_map { |id| posts_by_id[id] }

        new_opts = {
          pagination_mode: :numbered, records_per_page: records_per_page, current_page: current_page,
          # Capped, not the raw scope.count - see capped_total_count. This is what keeps
          # PaginatorComponent's own last_page/has_next? (computed from total_pages, which
          # derives from total_count) from ever advertising a page beyond what
          # validate_numbered_page! actually allows.
          total_count: capped_total_count(count, records_per_page),
          # Kept strictly above Danbooru.config.max_numbered_pages (the real, unmodified
          # validation ceiling parse_page/validate_numbered_page! enforce above) so
          # PaginatorComponent's own `current_page >= max_numbered_pages` switch - shared,
          # global, deliberately untouched - never fires for this PostSet: it always renders
          # plain "?page=N" links, never "aXX"/"bXX" cursor links, for any folder page a
          # numbered request can actually reach. This is a per-instance PaginatedArray
          # option already designed for this purpose; no shared paginator code changes.
          max_numbered_pages: folder_max_numbered_pages,
        }
        ::Danbooru::Paginator::PaginatedArray.new(ordered_posts, new_opts)
      end
    end

    # One page past Danbooru.config.max_numbered_pages (the real, global, unmodified
    # validation ceiling that parse_page/validate_numbered_page! enforce above). Computed
    # per-call, not memoized/frozen at load time, so it stays correct if a spec ever swaps
    # Danbooru.config. Only ever used as a PaginatedArray#max_numbered_pages override - it
    # does not raise the true, global page-count ceiling itself.
    def folder_max_numbered_pages
      Danbooru.config.max_numbered_pages + 1
    end

    # PaginatorComponent computes last_page/has_next? purely from
    # [total_pages, max_numbered_pages].min, and total_pages derives from total_count. Left
    # uncapped, a folder whose real content exceeds the real ceiling would report a
    # total_pages one past it (since max_numbered_pages here is deliberately inflated by 1
    # - see folder_max_numbered_pages) - advertising a "Next" link to a page number
    # validate_numbered_page! then rejects. Capping total_count itself (not
    # max_numbered_pages, which still needs its +1 to suppress cursor-mode rendering) keeps
    # total_pages, and so last_page/has_next?/the numbered page-number list, from ever
    # exceeding the real, reachable ceiling. The actual per-page query above is untouched -
    # this only affects pagination metadata, never which posts a given page shows.
    def capped_total_count(count, records_per_page)
      return count unless records_per_page > 0
      [count, Danbooru.config.max_numbered_pages * records_per_page].min
    end
  end
end
