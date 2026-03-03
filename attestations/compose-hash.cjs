const fs = require("fs");
const crypto = require("crypto");

function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function canonical(obj) {
  if (Array.isArray(obj)) {
    return obj.map(canonical);
  } else if (obj && typeof obj === "object") {
    return Object.keys(obj)
      .sort()
      .reduce((acc, key) => {
        acc[key] = canonical(obj[key]);
        return acc;
      }, {});
  } else {
    return obj;
  }
}

const input = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));

// Fields DStack actually hashes
const filtered = {
  allowed_envs: input.allowed_envs,
  docker_compose_file: input.docker_compose_file,
  features: input.features,
  manifest_version: input.manifest_version,
  runner: input.runner,
};

// Canonicalize (alphabetical key ordering)
const canonicalJson = JSON.stringify(canonical(filtered));

// Hash it
const hash = sha256(canonicalJson);

console.log("Canonical JSON:", canonicalJson);
console.log("SHA256:", hash);
