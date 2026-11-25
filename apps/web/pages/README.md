# Not a Pages Router

Next must not treat `src/pages` as a Pages Router. FSD page slices live in `src/pages`; this empty folder at the app root only keeps Next from guessing. Routes are in `app/` as thin wrappers.
