@echo off

echo.
if not exist ..\..\dmc\nul goto not_installed
if not exist ..\..\dmc\liblist.gam goto not_installed

if not exist ..\..\dmc\old_liblist.gam goto no_HPB_bot

del ..\..\dmc\liblist.gam

echo Dosyalar Siliniyor
rename ..\..\dmc\old_liblist.gam liblist.gam

echo.
del ..\..\dmc\HPB_bot.cfg
del ..\..\dmc\HPB_bot_names.txt
del ..\..\dmc\HPB_bot_chat.txt

echo.
del ..\..\dmc\dlls\HPB_bot.dll

echo.
echo.
echo SILME ISLEMI BASARIYLA TAMAMLANDI
goto done

:not_installed
echo Deathmatch Classic kurulu degil
echo.
echo Kurulum islemi basarisiz
goto done

:no_HPB_bot
echo e-XPLoDeR HPB Bot Kurulu Degil
echo.
goto done

:done
echo.
echo.
pause
