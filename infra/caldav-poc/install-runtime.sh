#!/bin/sh
# After deployment approval ONLY. No apt, no global pip, no AI Calendar changes.
# Input: reviewed POC sources and a prebuilt wheelhouse already copied to /opt.
set -eu
base=/opt/ai-calendar-caldav-poc
test "$(id -u)" = 0
test -f "$base/requirements.txt"
test -f "$base/wheelhouse/pip-25.2-py3-none-any.whl"
test ! -e "$base/venv"
test ! -e /etc/ai-calendar-caldav-poc/config
test ! -e /var/lib/ai-calendar-caldav-poc
if ! id caldav-poc >/dev/null 2>&1; then
    useradd --system --no-create-home --shell /usr/sbin/nologin caldav-poc
fi
python3 -m venv --without-pip "$base/venv"
# Run pip straight from the local wheel, without installing it globally.
PYTHONPATH="$base/wheelhouse/pip-25.2-py3-none-any.whl" "$base/venv/bin/python" -m pip install \
    --no-index --find-links "$base/wheelhouse" --no-compile -r "$base/requirements.txt"
install -d -m 0750 -o root -g caldav-poc /etc/ai-calendar-caldav-poc
install -d -m 0700 -o caldav-poc -g caldav-poc /var/lib/ai-calendar-caldav-poc
install -m 0640 -o root -g caldav-poc "$base/config.example" /etc/ai-calendar-caldav-poc/config
install -m 0644 "$base/nginx-path.conf.example" /etc/ai-calendar-caldav-poc/nginx-path.conf
install -m 0644 "$base/ai-calendar-caldav-poc.service" /etc/systemd/system/ai-calendar-caldav-poc.service
echo 'Runtime staged. Create users interactively; review nginx diff before starting.'
# Intentionally no start/enable/reload, no credentials, no automatic DNS/cert changes.
