# Add order files

Use **Add files** on the order library page to upload files into this folder,
then choose **Commit changes** to save them on `main`.

Accepted files:

- `order_data_*.js` created by the existing Input/Output converter.
- UTF-8 `.txt` containing one or more court orders. Each order must end with
  `इति संवत` or `ईति संवत`, as in the converter.

Subfolders are supported. Existing `order_data_*.js` files in the repository
root are also read automatically. Keep the original filenames when updating a
file. Remove an input file to remove its orders from the generated list.

The **Update order library** GitHub Action rebuilds `order-index.json` after
each commit and publishes the refreshed list. No edits to `orders.html` or the
index are needed. Allow a few minutes for the action and Pages to finish, then
refresh the website. If an upload is invalid, the action reports its filename
and keeps the previously published index.
