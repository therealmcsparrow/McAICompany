# Personalities

## In short
Every Role has a personality that colours how it sounds in water-cooler chats and brainstorm rounds. It is style only. It never changes a model, a verdict, a review, a Gate or any real work.

## How it works
1. Open [`/aico:settings`](../commands/settings.md) and go to the Personality tab.
2. Change the five fields of a Role at user level or project level.
3. Start a [`/aico:cooler`](../commands/cooler.md) chat or a [`/aico:brainstorm`](../commands/brainstorm.md) round to hear the result.

## Technical details
Every Role has a personality that colours how it comes across in [`/aico:cooler`](../commands/cooler.md) chats and [`/aico:brainstorm`](../commands/brainstorm.md) rounds. It is social-only style data, used there and nowhere else. It never changes a model, an effort, a verdict, a review, a Gate, a Handoff or any other dispatch.

A personality has five fields:
- **Temperament**, **Way of talking** and **Pet topic**: short text, 1 to 80 characters. Letters of any language, digits, single spaces and the marks `, . ' - ! ?` are allowed. Quotes, colons, brackets, line breaks and other symbols are refused.
- **Intelligence** and **Creativity**: `low`, `medium` or `high`. The Role is told a fixed sentence for the level you pick, not the word itself. Creativity shows in how far the ideas reach. Intelligence shapes how the Role reasons, but brainstorm replies are capped at 80 words, so you will see little of it there.

Every Role ships with a default. You can change each field at user level (all projects) or project level. Per field, the project value wins over the user value, which wins over the default. A project value counts without an unlock, so a cloned repo can set a personality. It is passed to the Role only as quoted style data, never as an instruction, and it can only reach cooler chats and brainstorms. A value that breaks the rules is ignored, the level below is used, and the settings page and `settings.mjs get` warnings say which field. The warning does not repeat the value.

Personalities are not part of `settings.mjs get` and are never printed by a command. Personality is about Roles, not real people, so keep real names out of it. Each word of a text field starts with a letter or a digit, and invisible characters are refused. In a first test, a personality changed the tone of brainstorm replies and did not lower the share of replies that pass the parser. A pet topic colours a reply only now and then.
