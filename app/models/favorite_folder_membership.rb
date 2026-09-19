# frozen_string_literal: true

class FavoriteFolderMembership < ApplicationRecord
  belongs_to :user
  belongs_to :folder, class_name: "FavoriteFolder"
  belongs_to :favorite

  validates :favorite_id, uniqueness: true
  validate :folder_belongs_to_same_user
  validate :user_matches_favorite_owner
  validate :post_matches_favorite_post

  private

  def folder_belongs_to_same_user
    return if folder.nil?
    errors.add(:folder, "must belong to you") if folder.user_id != user_id
  end

  # user_id/post_id are denormalized copies of the referenced Favorite's own user_id/
  # post_id, captured so folder pages never need to join back into favorites. These
  # validations guard against that copy ever drifting out of sync with its source.
  # Note: FavoriteFolderManager.move! writes via upsert, which (like insert_all/update_all)
  # bypasses AR validations entirely - this is enforced there by construction instead
  # (user_id/post_id are always read directly off the already-loaded `user`/`favorite`
  # objects, never independently supplied), so this validation's real audience is any
  # other write path: specs, console usage, and future code.
  def user_matches_favorite_owner
    return if favorite.nil?
    errors.add(:user_id, "must match the favorite's owner") if favorite.user_id != user_id
  end

  def post_matches_favorite_post
    return if favorite.nil?
    errors.add(:post_id, "must match the favorite's post") if favorite.post_id != post_id
  end
end
