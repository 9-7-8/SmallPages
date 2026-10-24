# Models

這裡的 tf.js 模型都是用 `tools/convert/` 從官方釋出的 PyTorch 權重自行轉換, 權重以 float16 存放.

| 目錄 | 原始權重 | 授權 |
|---|---|---|
| realesrgan/general_fast-64 | realesr-general-x4v3 + realesr-general-wdn-x4v3 ( 各 0.5 內插 ) | BSD-3-Clause, `realesrgan/LICENSE` |
| realesrgan/anime_fast-64 | realesr-animevideov3 | BSD-3-Clause, `realesrgan/LICENSE` |
| realcugan/2x-{conservative,no-denoise,denoise1x,denoise2x,denoise3x}-64 | up2x-latest-*.pth | MIT, `realcugan/LICENSE` |
| realcugan/4x-{conservative,no-denoise,denoise3x}-64 | up4x-latest-*.pth | MIT, `realcugan/LICENSE` |

 - Real-ESRGAN: https://github.com/xinntao/Real-ESRGAN ( Copyright (c) 2021, Xintao Wang )
 - Real-CUGAN: https://github.com/bilibili/ailab/tree/main/Real-CUGAN ( Copyright (c) 2022 bilibili )

權重下載網址、sha256、轉換流程與工具版本見 `tools/convert/README.md`.


## 未附的模型

`realesrgan/general_plus` 與 `realesrgan/anime_plus` 目前未附. 這兩個是 RRDBNet 架構的高品質模型, 檔案較大:

| 模型 | 原始權重 | 原始大小 | 轉換後 ( fp16 ) |
|---|---|---|---|
| general_plus | RealESRGAN_x4plus ( RRDBNet, 23 blocks ) https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth | 約 64MB | 約 32MB |
| anime_plus | RealESRGAN_x4plus_anime_6B ( RRDBNet, 6 blocks ) https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.2.4/RealESRGAN_x4plus_anime_6B.pth | 約 17MB | 約 9MB |

需要時把權重放進 `tools/convert/weights/`, 再執行:

    venv/bin/python tools/convert/convert.py realesrgan/general_plus realesrgan/anime_plus

就會產生 `models/realesrgan/general_plus-64/` 與 `anime_plus-64/`. 轉換流程已用隨機權重驗證過 ( TF 與 PyTorch 輸出一致, signature 與權重數量也與先前的 xororz 版本相同 ), 但還沒用正式權重跑過, 補回來時請用 `tools/convert/compare.js` 實際跑圖確認.
