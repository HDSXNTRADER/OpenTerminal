# OpenBB Open Data Platform REST API (https://github.com/OpenBB-finance/OpenBB),
# used by the api service as its first-choice data source when OPENBB_URL is set.
FROM python:3.12-slim

ARG OPENBB_VERSION=5.0.0
# Extra OpenBB vendor extensions to install, space-separated
# (e.g. "openbb-fmp openbb-polygon" for paid data — then set OPENBB_PROVIDER).
ARG OPENBB_EXTRAS=""

ENV PYTHONDONTWRITEBYTECODE=1 PIP_NO_CACHE_DIR=1
# openbb 5 no longer bundles the equity router or the yfinance vendor.
RUN pip install "openbb==${OPENBB_VERSION}" openbb-equity==2.0.0 openbb-yfinance==2.0.0 ${OPENBB_EXTRAS}

# Vendor API keys go in /root/.openbb_platform/user_settings.json (mounted by
# docker-compose), or as OPENBB_* env vars documented by OpenBB.
EXPOSE 6900
CMD ["openbb-api", "--host", "0.0.0.0", "--port", "6900"]
