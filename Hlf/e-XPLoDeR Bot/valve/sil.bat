@echo off

echo.
if not exist ..\..\valve\nul goto not_installed
if not exist ..\..\valve\liblist.gam goto not_installed

if not exist ..\..\valve\old_liblist.gam goto no_HPB_bot

del ..\..\valve\liblist.gam

echo Dosyalar Siliniyor
rename ..\..\valve\old_liblist.gam liblist.gam

echo.
del ..\..\valve\HPB_bot.cfg
del ..\..\valve\HPB_bot_names.txt
del ..\..\valve\HPB_bot_chat.txt

echo.
del ..\..\valve\dlls\HPB_bot.dll

echo.
echo.
echo BASARI ILE SILINDI
goto done

:not_installed
echo Half-Life Kurulu Degil
echo.
echo Silme Islemi Basarisiz
goto done

:no_HPB_bot
echo e-XPLoDeR & HPB Bot Kurulu Degil
echo.
goto done

:done
echo.
echo.
pause
