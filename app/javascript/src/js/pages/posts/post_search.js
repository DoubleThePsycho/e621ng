import LStorage from "@/utility/Storage";
import Page from "@/utility/Page";
import Offclick from "@/utility/Offclick";

const PostSearch = {};

PostSearch.SUPPORTED_ORDER_ASC_ROOTS = [
  "score",
  "favcount",
  "created",
  "updated",
  "change",
  "comment",
  "comment_count",
  "comment_bumped",
  "mpixels",
  "filesize",
  "duration",
  "tagcount",
  "general_tags",
  "artist_tags",
  "contributor_tags",
  "copyright_tags",
  "character_tags",
  "species_tags",
  "invalid_tags",
  "meta_tags",
  "lore_tags",
  "md5",
  "note",
];
PostSearch.SUPPORTED_ORDER_STANDALONE_VALUES = [
  "random",
  "hot",
  "landscape",
  "portrait",
];
PostSearch.SUPPORTED_ORDER_EXPLICIT_VALUES = [
  "id",
  "id_desc",
];
PostSearch.SUPPORTED_ORDER_VALUES = PostSearch.SUPPORTED_ORDER_ASC_ROOTS
  .flatMap(root => [root, root + "_asc"])
  .concat(PostSearch.SUPPORTED_ORDER_STANDALONE_VALUES)
  .concat(PostSearch.SUPPORTED_ORDER_EXPLICIT_VALUES);
PostSearch.ORDER_CUSTOM = "__custom";

PostSearch.initialize_input = function ($form) {
  const $textarea = $form.find("textarea[name='tags']").first();
  if (!$textarea.length) return;
  const element = $textarea[0];

  // Adjust the number of rows based on input length
  $textarea
    .on("input", recalculateInputHeight)
    .on("keypress", function (event) {
      if (event.which !== 13 || event.shiftKey) return;
      event.preventDefault();
      $textarea.closest("form").trigger("submit");
    });

  $(window).on("resize", recalculateInputHeight);

  // Reset default height
  recalculateInputHeight();

  function recalculateInputHeight () {
    $textarea.css("height", 0);
    $textarea.css("height", element.scrollHeight + "px");
  }
};

PostSearch.initialize_advanced_search = function ($section) {
  const $textarea = $section.find("textarea[name='tags']").first();
  const $sort = $section.find("[data-advanced-search='sort']").first();
  const $inpool = $section.find("[data-advanced-search='inpool']").first();

  if (!$textarea.length || !$sort.length || !$inpool.length) return;

  const syncControls = function () {
    const state = PostSearch.advanced_search_state($textarea.val() + "");
    $sort.val(state.order);
    $inpool.val(state.inpool);
  };

  const updateOrder = function () {
    $textarea.val(PostSearch.replace_order_metatags($textarea.val() + "", $sort.val()));
    $textarea.trigger("input");
    syncControls();
  };

  const updateInpool = function () {
    $textarea.val(PostSearch.replace_inpool_metatags($textarea.val() + "", $inpool.val()));
    $textarea.trigger("input");
    syncControls();
  };

  $textarea.on("input", syncControls);
  $sort.on("change", updateOrder);
  $inpool.on("change", updateInpool);

  syncControls();
};

PostSearch.advanced_search_state = function (query) {
  const state = {
    order: "",
    inpool: "",
  };

  for (const token of PostSearch.scan_top_level_tokens(query)) {
    const order = PostSearch.parse_order_token(token.text);
    if (order) state.order = order;

    const inpool = PostSearch.parse_inpool_token(token.text);
    if (inpool !== null) state.inpool = inpool;
  }

  return state;
};

PostSearch.scan_top_level_tokens = function (query) {
  const tokens = [];
  let depth = 0;
  let quoted = false;
  let start = null;
  let startDepth = 0;

  for (let i = 0; i <= query.length; i++) {
    const char = query[i] || "";
    const atEnd = i === query.length;
    const whitespace = atEnd || /\s/.test(char);

    if (start === null && !atEnd && !whitespace) {
      start = i;
      startDepth = depth;
    }

    if (whitespace && !quoted && start !== null) {
      const text = query.slice(start, i);
      if (startDepth === 0) tokens.push({ text, start, end: i });
      start = null;
    }

    if (atEnd) continue;
    if (char === "\"") quoted = !quoted;
    if (quoted) continue;

    if (char === "(") depth += 1;
    if (char === ")" && depth > 0) depth -= 1;
  }

  return tokens;
};

PostSearch.parse_order_token = function (text) {
  const match = text.match(/^(-?)order:(.+)$/i);
  if (!match) return null;

  let value = PostSearch.unquote_metatag_value(match[2]).toLowerCase();
  const negated = match[1] === "-";

  if (PostSearch.SUPPORTED_ORDER_STANDALONE_VALUES.includes(value)) {
    return negated ? PostSearch.ORDER_CUSTOM : value;
  }

  if (PostSearch.SUPPORTED_ORDER_EXPLICIT_VALUES.includes(value)) {
    if (!negated) return value;
    return value === "id" ? "id_desc" : "id";
  }

  if (value.endsWith("_desc")) value = value.slice(0, -5);

  const root = value.replace(/_asc$/, "");
  if (!PostSearch.SUPPORTED_ORDER_ASC_ROOTS.includes(root)) {
    return PostSearch.ORDER_CUSTOM;
  }

  let order = value.endsWith("_asc") ? root + "_asc" : root;

  if (negated) {
    order = order.endsWith("_asc") ? root : root + "_asc";
  }

  return order;
};

PostSearch.parse_inpool_token = function (text) {
  const match = text.match(/^inpool:(true|false)$/i);
  if (!match) return null;
  return match[1].toLowerCase();
};

PostSearch.unquote_metatag_value = function (value) {
  if (value.startsWith("\"") && value.endsWith("\"")) return value.slice(1, -1);
  return value;
};

PostSearch.replace_order_metatags = function (query, value) {
  if (value === PostSearch.ORDER_CUSTOM) return query;

  const newToken = value && PostSearch.SUPPORTED_ORDER_VALUES.includes(value)
    ? "order:" + value
    : "";

  return PostSearch.replace_top_level_metatags(query, (token) => !!PostSearch.parse_order_token(token), newToken);
};

PostSearch.replace_inpool_metatags = function (query, value) {
  const newToken = value ? "inpool:" + value : "";
  return PostSearch.replace_top_level_metatags(query, (token) => PostSearch.parse_inpool_token(token) !== null, newToken);
};

PostSearch.replace_top_level_metatags = function (query, matcher, newToken) {
  const tokens = PostSearch.scan_top_level_tokens(query).filter(token => matcher(token.text));
  let result = query;

  for (const token of tokens.reverse()) {
    result = PostSearch.remove_token_range(result, token.start, token.end);
  }

  result = result.trim();
  if (newToken) result = [result, newToken].filter(n => n).join(" ");

  return result;
};

PostSearch.remove_token_range = function (query, start, end) {
  let removeStart = start;
  let removeEnd = end;

  while (removeEnd < query.length && /\s/.test(query[removeEnd])) removeEnd += 1;
  if (removeEnd === end) {
    while (removeStart > 0 && /\s/.test(query[removeStart - 1])) removeStart -= 1;
  }

  return query.slice(0, removeStart) + query.slice(removeEnd);
};

PostSearch.initialize_wiki_preview = function ($preview) {
  let visible = LStorage.Posts.WikiExcerpt;
  if (visible == 2) return; // hidden
  if (visible == 1) $preview.addClass("open");
  $preview.removeClass("hidden");

  window.setTimeout(() => { // Disable the rollout on first load
    $preview.removeClass("loading");
  }, 250);

  // Toggle the excerpt box open / closed
  $($preview.find("h3.wiki-excerpt-toggle")).on("click", (event) => {
    event.preventDefault();

    visible = !visible;
    $preview.toggleClass("open", visible);
    LStorage.Posts.WikiExcerpt = Number(visible);

    return false;
  });

  // Hide the excerpt box entirely
  $preview.find("button.wiki-excerpt-dismiss").on("click", (event) => {
    event.preventDefault();

    $preview.addClass("hidden");
    LStorage.Posts.WikiExcerpt = 2;

    return false;
  });
};

PostSearch.initialize_controls = function () {
  // Regular buttons
  let fullscreen = LStorage.Posts.Fullscreen;
  $("#search-fullscreen").on("click", () => {
    fullscreen = !fullscreen;
    $("body").attr("data-st-fullscreen", fullscreen);
    LStorage.Posts.Fullscreen = fullscreen;
  });

  // Menu open / close
  const offclickHandler = Offclick.register("#search-settings", ".search-settings-container", () => {
    menu.removeClass("active");
    menuButton.removeClass("active");
  });

  const menu = $(".search-settings-container");
  const menuButton = $("#search-settings").on("click", () => {
    const state = offclickHandler.disabled;
    menu.toggleClass("active", state);
    menuButton.toggleClass("active", state);
    offclickHandler.disabled = !state;
  });

  $("#search-settings-close").on("click", (event) => {
    event.preventDefault();
    menu.removeClass("active");
    menuButton.removeClass("active");
    offclickHandler.disabled = true;
  });

  // Menu toggles
  $("#ssc-image-contain")
    .prop("checked", LStorage.Posts.Contain)
    .on("change", (event) => {
      LStorage.Posts.Contain = event.target.checked;
      $("body").attr("data-st-contain", event.target.checked);
    });

  $("input[type='radio'][name='ssc-card-size']")
    .on("change", (event) => {
      LStorage.Posts.Size = event.target.value;
      $("body").attr("data-st-size", event.target.value);
    });
  $("input[type='radio'][name='ssc-card-size'][value='" + LStorage.Posts.Size + "']")
    .prop("checked", true);

  function updateHoverTextNodes () {
    $("a[data-hover-text]").attr("title", function () {
      const source = $(this).data("hover-text");
      if (!source) return "";

      switch (LStorage.Posts.HoverText) {
        case "none":
          return "";
        case "short":
          return source.split("\n\n")[0];
        case "long":
        default:
          return source;
      }
    });
  }
  $("input[type='radio'][name='ssc-hover-text']")
    .on("change", (event) => {
      LStorage.Posts.HoverText = event.target.value;
      updateHoverTextNodes();
    });
  $("input[type='radio'][name='ssc-hover-text'][value='" + LStorage.Posts.HoverText + "']")
    .prop("checked", true);
  updateHoverTextNodes();

  $("#ssc-sticky-searchbar")
    .prop("checked", LStorage.Posts.StickySearch)
    .on("change", (event) => {
      LStorage.Posts.StickySearch = event.target.checked;
      $("body").attr("data-st-stickysearch", event.target.checked);
    });
};

$(() => {

  $(".post-search").each((index, element) => {
    const $element = $(element);
    PostSearch.initialize_input($element);
    PostSearch.initialize_advanced_search($element);
  });

  if (!Page.matches("posts") && !Page.matches("favorites"))
    return;

  $(".wiki-excerpt").each((index, element) => {
    PostSearch.initialize_wiki_preview($(element));
  });

  PostSearch.initialize_controls();
});

export default PostSearch;
