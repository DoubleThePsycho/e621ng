import Sortable from "@/utility/Sortable";

$(() => {
  const orderForm = $("#ordering-form"),
    idInput = $("#pool_post_ids_string");
  const originalIDs = idInput.val();
  const nav = document.querySelector("nav.navigation");

  new Sortable($("section.sortable"), {
    itemSelector: ".sortable-thumbnail",
    handleSelector: ".sortable-handle",
    onReorder: (orderedIDs: string[]) => {
      const idString = orderedIDs.join(" ");
      idInput.val(idString);

      orderForm.toggleClass("changed", idString !== originalIDs);
    },
    // Bottom of the header while it's on screen (always, if sticky), so it doesn't cover the scroll zone
    autoScrollTopInset: () => (nav ? Math.max(nav.getBoundingClientRect().bottom, 0) : 0),
  });
});
