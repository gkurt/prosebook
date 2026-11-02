---
packages:
  'prosebook': minor
---

### Apple `.strings` tables, Info.plist's included

`native: [{ language: 'apple', out: 'src-tauri/Resources', keys: ['macos'], plist: 'src-tauri/Info.plist' }]` makes `generate` write `<locale>.lproj/InfoPlist.strings` per locale, so permission prompts and the app's name are translated. `macos.ns-camera-usage-description` is `NSCameraUsageDescription`, and a key the plist lacks, or plist text that differs from the source, fails the build. Without `plist`, the table is `Localizable`, with placeholders as `%1$@`.
