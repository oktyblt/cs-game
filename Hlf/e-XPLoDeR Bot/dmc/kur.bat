@echo off

echo.
if not exist ..\..\dmc\nul goto not_installed
if not exist ..\..\dmc\liblist.gam goto not_installed

if exist ..\..\dmc\old_liblist.gam goto already_installed

echo Dosyalar kopyalaniyor
copy liblist.gam ..\..\dmc\liblist.gam
copy old_liblist.gam ..\..\dmc\old_liblist.gam

echo.
copy HPB_bot.cfg ..\..\dmc\HPB_bot.cfg
copy ..\HPB_bot_names.txt ..\..\dmc\HPB_bot_names.txt
copy ..\HPB_bot_chat.txt ..\..\dmc\HPB_bot_chat.txt

echo.
copy *.HPB_wpt ..\..\dmc\maps

echo.
copy ..\HPB_bot.dll ..\..\dmc\dlls
echo.
echo.
echo KURULUM ISLEMI BASARIYLA TAMAMLANDI
goto done

:not_installed
echo Deathmatch Classic kurulu degil
echo.
echo Kurulum islemi basarisiz
goto done

:already_installed
echo e-XPLoDeR & HPB Bot daha onceden kurulmus
echo.
echo Lutfen Sil dosyasini calistirin ve tekrar deneyin
goto done

:done
echo.
echo.
pause
