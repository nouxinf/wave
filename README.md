# wave

_wave_ is a super tiny js canvas game inspired by Geometry Dash wave segments. You click to go up and let go to go down, and you need to fit through randomly generated obstacles!

## how to use it

Just copy the text in [dist/uri.txt](https://raw.githubusercontent.com/nouxinf/wave/refs/heads/main/dist/uri.txt) into your address bar and you're good to go! That code you see is the entire game, no internet is needed.

## building

In order to turn the game file (`src/index.html`) into a minified data URI we use an aggressive minifaction script in `build.mjs`

```
npm i
node build.mjs
```
