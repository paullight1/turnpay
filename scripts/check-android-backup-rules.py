from pathlib import Path
import xml.etree.ElementTree as ET


def check_exclusions(section, name):
    if section is None:
        raise SystemExit(f"Missing Android backup section: {name}")

    excluded = {
        rule.get("path")
        for rule in section.findall("exclude[@domain='sharedpref']")
    }
    required = {
        f"{store}.xml{suffix}"
        for store in ("FlutterSecureStorage", "FlutterSecureKeyStorage")
        for suffix in ("", ".bak")
    }
    if missing := required - excluded:
        raise SystemExit(f"{name} can back up secure storage: {', '.join(sorted(missing))}")


source = Path(__file__).resolve().parents[1] / "APP/android/app/src/main"
application = ET.parse(source / "AndroidManifest.xml").find("application")
android = "{http://schemas.android.com/apk/res/android}"

def read_rules(attribute, name, root_tag):
    if application.get(android + attribute) != f"@xml/{name}":
        raise SystemExit(f"Android manifest does not reference the {attribute} rules")
    rules = ET.parse(source / "res/xml" / f"{name}.xml").getroot()
    if rules.tag != root_tag:
        raise SystemExit(f"Expected {root_tag} in {name}.xml")
    return rules


legacy = read_rules("fullBackupContent", "backup_rules", "full-backup-content")
check_exclusions(legacy, legacy.tag)

modern = read_rules("dataExtractionRules", "data_extraction_rules", "data-extraction-rules")
for section in ("cloud-backup", "device-transfer"):
    check_exclusions(modern.find(section), section)

print("Android secure storage is excluded from legacy backup, cloud backup and device transfer.")
