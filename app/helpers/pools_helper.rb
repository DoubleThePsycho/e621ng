# frozen_string_literal: true

module PoolsHelper
  def recent_updated_pools
    pool_ids = session[:recent_pool_ids].to_s.scan(/\d+/)
    if pool_ids.any?
      Pool.where(["id IN (?)", pool_ids])
    else
      []
    end
  end

  def pool_reader_post_data(post)
    visible = post.visible?
    {
      id:               post.id,
      preview_url:      visible ? post.preview_file_url_pair[1] : nil,
      preview_url_webp: visible ? post.preview_file_url_pair[0] : nil,
      file_url:         visible ? post.file_url_for(CurrentUser.user) : nil,
      file_ext:         post.file_ext,
      width:            post.image_width,
      height:           post.image_height,
      is_video:         post.is_video?,
      is_flash:         post.is_flash?,
      display_class:    visible ? post.display_class_for(CurrentUser.user) : nil,
      video_sources:    (visible && post.is_video?) ? post.initial_video_urls : [],
      rating:           post.rating,
      visible:          visible,
      loginblocked:     post.loginblocked?,
      safeblocked:      post.safeblocked?,
      deleteblocked:    post.deleteblocked?,
    }
  end
end
