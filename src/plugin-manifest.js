// What the engine knows about a first party plugin before that plugin's code has loaded:
// the attributes that ask for it, which of them are boundaries the engine must stay out
// of, and the helper names it adds to expressions. Data only. A plugin's own file
// spreads its entry into its definition, so the two cannot disagree. An entry changes
// what existing markup means, so each one ships in a minor release with a changelog
// line. None ships yet.

export const PLUGIN_API = 1;

export const MANIFEST = {};
