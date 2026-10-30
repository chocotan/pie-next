# Pie background task adaptation

`background-process.ts` and the execution lifecycle in `background.ts` adapt Pie's
`extensions/background/registry.ts`, `process-tree.ts`, `windows-taskkill.ts`, and
`utils/child-process.ts`. Those files adapt shell process management from
https://github.com/ismailsaleekh/pi-background-tasks at revision
`799182ff65d7040732aea23b2001ea860b688531`.

ISC License

Copyright (c) 2026

Permission to use, copy, modify, and/or distribute this software for any purpose
with or without fee is hereby granted, provided that the above copyright notice
and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
THIS SOFTWARE.
