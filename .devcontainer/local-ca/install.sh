#!/bin/sh
set -e

cp /tmp/sitniks.pem /etc/pki/ca-trust/source/anchors/sitniks.pem
update-ca-trust
