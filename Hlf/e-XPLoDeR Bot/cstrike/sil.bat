@echo off

echo.
if not exist ..\..\cstrike\nul goto not_installed
if not exist ..\..\cstrike\liblist.gam goto not_installed

if not exist ..\..\cstrike\old_liblist.gam goto no_HPB_bot

del ..\..\cstrike\liblist.gam

rename ..\..\cstrike\old_liblist.gam liblist.gam

echo.
echo Dosyalar Siliniyor
del ..\..\cstrike\HPB_bot.cfg
del ..\..\cstrike\HPB_bot_names.txt
del ..\..\cstrike\HPB_bot_chat.txt

echo.
del ..\..\cstrike\dlls\HPB_bot.dll

echo.
echo.
echo BASARI ILE SILINDI
goto done

:not_installed
echo Counter-Strike Kurulu Degil
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
