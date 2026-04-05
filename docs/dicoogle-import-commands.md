# Dicoogle Source Import Commands

Run from repository root (`metupalle-jpg/tdai`):

```bash
rm -rf /tmp/dicoogle-src
git clone --depth 1 https://github.com/bioinformatics-ua/dicoogle.git /tmp/dicoogle-src
mkdir -p packages/dicoogle-server
rm -rf packages/dicoogle-server/*
cp -a /tmp/dicoogle-src/. packages/dicoogle-server/
rm -rf packages/dicoogle-server/.git
```

If cloning is blocked, download latest runtime jars from <https://dicoogle.com/downloads> and place in:

```text
packages/dicoogle-server/bin/
```

Required files:

- `dicoogle.jar`
- `lucene.jar`
- `filestorage.jar`
