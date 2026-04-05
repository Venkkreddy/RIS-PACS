# OHIF Source Import Commands

Run from repository root (`metupalle-jpg/tdai`):

```bash
rm -rf /tmp/ohif-src
git clone --depth 1 https://github.com/OHIF/Viewers.git /tmp/ohif-src
mkdir -p packages/ohif-viewer
rm -rf packages/ohif-viewer/*
cp -a /tmp/ohif-src/. packages/ohif-viewer/
rm -rf packages/ohif-viewer/.git
```

Custom extension location:

```text
packages/ohif-viewer/extensions/reporting-extension/
```
