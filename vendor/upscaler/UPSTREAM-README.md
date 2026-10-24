# @plotdb/upscaler

a simple wrapper of web-based upscaler, based on web-realesrgan

Reference:

 - https://github.com/xororz/web-realesrgan
 - https://upscale.chino.icu/

for usage, check `usage.md`.


## License

Real-CUGAN:
 - https://github.com/bilibili/ailab/blob/main/Real-CUGAN/LICENSE
 - MIT License

Real-ESRGAN:
 - https://github.com/xinntao/Real-ESRGAN/blob/master/LICENSE
 - BSD 3-Clause License

Converted models:
 - converted by ourselves from the official PyTorch weights to tf.js, with scripts in `tools/convert/`
 - the converted models keep the license of the original weights ( see `models/README.md`, `models/realesrgan/LICENSE`, `models/realcugan/LICENSE` )
 - Real-ESRGAN `general_plus` / `anime_plus` are not shipped for now; see `models/README.md` for how to convert them
