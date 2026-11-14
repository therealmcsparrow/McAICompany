// Rule ID grammar shared by rule-check and the guards. No import: pure.

const ID = '[a-z][a-z0-9-]{0,23}\\.(?:M-SEC|M|S|Y)\\d+';

export const RULE_ID = new RegExp(`^${ID}$`);
export const RULE_ID_ANY = new RegExp(`(?<![A-Za-z0-9-])${ID}`, 'g');
