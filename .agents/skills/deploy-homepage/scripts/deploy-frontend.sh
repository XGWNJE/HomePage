#!/usr/bin/env bash
set -Eeuo pipefail

mode="$1"
release_id="$2"
archive_sha="$3"
expected_count="$4"
expected_bytes="$5"
expected_index_sha="$6"
previous_release="$7"
expected_tree_sha="${8:-}"

staging_root="${HOMEPAGE_STAGING_ROOT:-/tmp}"
releases_root="${HOMEPAGE_RELEASES_ROOT:-/var/www/xgwnje-home.releases}"
release_dir="${releases_root}/${release_id}"
archive="homepage-frontend-${release_id}.tar.gz"
delta_archive="homepage-frontend-delta-${release_id}.tar.gz"
manifest="release-manifest-${release_id}.json"
changed_files="CHANGED_FILES"
deleted_files="DELETED_FILES"
new_prefix="${HOMEPAGE_NEW_PREFIX:-/var/www/xgwnje-home.new}"
live_dir="${HOMEPAGE_LIVE_DIR:-/var/www/xgwnje-home}"
backup_prefix="${HOMEPAGE_BACKUP_PREFIX:-/var/www/xgwnje-home.backup}"
failed_prefix="${HOMEPAGE_FAILED_PREFIX:-/var/www/xgwnje-home.failed}"
release_owner="${HOMEPAGE_RELEASE_OWNER-www-data:www-data}"
lock_file="${HOMEPAGE_FRONTEND_LOCK_FILE:-/tmp/xgwnje-home-frontend-release.lock}"
lock_held="${HOMEPAGE_FRONTEND_LOCK_HELD:-0}"
staging="${staging_root}/homepage-release-${release_id}"
new_dir="${new_prefix}-${release_id}"
backup_dir="${backup_prefix}-${release_id}"

validate_release_path() {
	path="$1"
	case "$path" in
		''|/*|*//*|*\\*) return 1 ;;
	esac
	case "/$path/" in
		*/../*|*/./*) return 1 ;;
	esac
}

calculate_tree_sha() {
	root="$1"
	listing="$2"
	(
		cd "$root"
		find . -type f -printf '%P\n' | LC_ALL=C sort | while IFS= read -r relative; do
			validate_release_path "$relative"
			printf '%s\t%s\t%s\n' "$(sha256sum "$relative" | awk '{print $1}')" "$(stat -c '%s' "$relative")" "$relative"
		done
	) > "$listing"
	sha256sum "$listing" | awk '{print $1}'
}

apply_site_permissions() {
	root="$1"
	if test -n "$release_owner"; then chown -R "$release_owner" "$root"; fi
	find "$root" -type d -exec chmod 755 {} +
	find "$root" -type f -exec chmod 644 {} +
}

acquire_release_lock() {
	if test "$lock_held" = 1; then return; fi
	exec 9>"$lock_file"
	flock -n 9
}

current_release_id() {
	basename "$(readlink -f "$releases_root/current")"
}

case "$mode" in
	prepare)
		test -d "$staging"
		test ! -e "$release_dir"
		test ! -e "$new_dir"
		mkdir -p "$release_dir/site"
		cp "$staging/$archive" "$staging/$manifest" "$staging/SHA256SUMS" "$staging/deploy-frontend.sh" "$release_dir/"
		cd "$release_dir"
		grep -F "  $archive" SHA256SUMS | sha256sum -c -
		grep -F "  $manifest" SHA256SUMS | sha256sum -c -
		test "$(sha256sum "$archive" | awk '{print $1}')" = "$archive_sha"
		tar -xzf "$archive" -C site
		test -f site/index.html
		actual_count="$(find site -type f | wc -l | tr -d ' ')"
		actual_bytes="$(find site -type f -printf '%s\n' | awk '{sum += $1} END {print sum + 0}')"
		actual_index_sha="$(sha256sum site/index.html | awk '{print $1}')"
		test "$actual_count" = "$expected_count"
		test "$actual_bytes" = "$expected_bytes"
		test "$actual_index_sha" = "$expected_index_sha"
		apply_site_permissions site
		cp -a site "$new_dir"
		printf 'PREPARED release=%s files=%s bytes=%s index=%s\n' "$release_id" "$actual_count" "$actual_bytes" "$actual_index_sha"
		;;
	prepare-delta)
		test -n "$expected_tree_sha"
		test -d "$staging"
		test -d "$releases_root/$previous_release/site"
		test ! -e "$release_dir"
		test ! -e "$new_dir"
		mkdir -p "$release_dir/site"
		cp "$staging/$delta_archive" "$staging/$manifest" "$staging/SHA256SUMS" "$staging/$changed_files" "$staging/$deleted_files" "$staging/deploy-frontend.sh" "$release_dir/"
		cd "$release_dir"
		sha256sum -c SHA256SUMS
		test "$(sha256sum "$delta_archive" | awk '{print $1}')" = "$archive_sha"
		test -s "$changed_files"
		cp -a "$releases_root/$previous_release/site/." site/

		tar -tzf "$delta_archive" | sed 's#^\./##' | LC_ALL=C sort > .archive-files
		LC_ALL=C sort "$changed_files" > .expected-files
		cmp -s .archive-files .expected-files

		while IFS= read -r relative; do
			test -n "$relative" || continue
			validate_release_path "$relative"
			rm -f -- "site/$relative"
			mkdir -p -- "site/$(dirname "$relative")"
		done < "$changed_files"
		tar -xzf "$delta_archive" -C site
		while IFS= read -r relative; do
			test -n "$relative" || continue
			validate_release_path "$relative"
			rm -f -- "site/$relative"
		done < "$deleted_files"

		test -f site/index.html
		actual_count="$(find site -type f | wc -l | tr -d ' ')"
		actual_bytes="$(find site -type f -printf '%s\n' | awk '{sum += $1} END {print sum + 0}')"
		actual_index_sha="$(sha256sum site/index.html | awk '{print $1}')"
		actual_tree_sha="$(calculate_tree_sha site .tree-files)"
		test "$actual_count" = "$expected_count"
		test "$actual_bytes" = "$expected_bytes"
		test "$actual_index_sha" = "$expected_index_sha"
		test "$actual_tree_sha" = "$expected_tree_sha"
		apply_site_permissions site
		cp -a site "$new_dir"
		printf 'PREPARED_DELTA release=%s changed=%s deleted=%s files=%s bytes=%s tree=%s\n' "$release_id" "$(grep -c . "$changed_files")" "$(grep -c . "$deleted_files" || true)" "$actual_count" "$actual_bytes" "$actual_tree_sha"
		;;
	activate)
		acquire_release_lock
		test "$(current_release_id)" = "$previous_release"
		test -d "$new_dir"
		test -f "$new_dir/index.html"
		test -d "$live_dir"
		test ! -e "$backup_dir"
		rollback_on_error() {
			status=$?
			if test -e "$live_dir"; then mv "$live_dir" "${failed_prefix}-${release_id}" || true; fi
			if test -d "$backup_dir"; then mv "$backup_dir" "$live_dir" || true; fi
			exit "$status"
		}
		trap rollback_on_error ERR
		mv "$live_dir" "$backup_dir"
		mv "$new_dir" "$live_dir"
		test -f "$live_dir/index.html"
		test "$(sha256sum "$live_dir/index.html" | awk '{print $1}')" = "$expected_index_sha"
		ln -sfn "$previous_release" "$releases_root/previous"
		ln -sfn "$release_id" "$releases_root/current"
		trap - ERR
		printf 'ACTIVATED release=%s backup=%s previous=%s\n' "$release_id" "$backup_dir" "$previous_release"
		;;
	rollback)
		acquire_release_lock
		test "$(current_release_id)" = "$release_id"
		test -d "$backup_dir"
		failed_dir="${failed_prefix}-${release_id}"
		test ! -e "$failed_dir"
		mv "$live_dir" "$failed_dir"
		mv "$backup_dir" "$live_dir"
		ln -sfn "$previous_release" "$releases_root/current"
		ln -sfn "$release_id" "$releases_root/previous"
		printf 'ROLLED_BACK release=%s restored=%s failed=%s\n' "$release_id" "$previous_release" "$failed_dir"
		;;
	*)
		printf 'Unknown mode: %s\n' "$mode" >&2
		exit 64
		;;
esac
