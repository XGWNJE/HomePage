#!/usr/bin/env bash
set -Eeuo pipefail

mode="$1"
release_id="$2"
archive_sha="$3"
expected_count="$4"
expected_bytes="$5"
expected_index_sha="$6"
previous_release="$7"

staging="/tmp/homepage-release-${release_id}"
releases_root="/var/www/xgwnje-home.releases"
release_dir="${releases_root}/${release_id}"
archive="homepage-frontend-${release_id}.tar.gz"
manifest="release-manifest-${release_id}.json"
new_dir="/var/www/xgwnje-home.new-${release_id}"
live_dir="/var/www/xgwnje-home"
backup_dir="/var/www/xgwnje-home.backup-${release_id}"

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
		chown -R www-data:www-data site
		find site -type d -exec chmod 755 {} +
		find site -type f -exec chmod 644 {} +
		cp -a site "$new_dir"
		printf 'PREPARED release=%s files=%s bytes=%s index=%s\n' "$release_id" "$actual_count" "$actual_bytes" "$actual_index_sha"
		;;
	activate)
		test -d "$new_dir"
		test -f "$new_dir/index.html"
		test -d "$live_dir"
		test ! -e "$backup_dir"
		rollback_on_error() {
			status=$?
			if test -e "$live_dir"; then mv "$live_dir" "/var/www/xgwnje-home.failed-${release_id}" || true; fi
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
		test -d "$backup_dir"
		failed_dir="/var/www/xgwnje-home.failed-${release_id}"
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
