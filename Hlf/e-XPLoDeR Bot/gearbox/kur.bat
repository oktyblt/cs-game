@echo off

echo.
if not exist ..\..\gearbox\nul goto not_installed
if not exist ..\..\gearbox\liblist.gam goto not_installed

if exist ..\..\gearbox\old_liblist.gam goto already_installed

echo Dosyalar Kopyalaniyor
copy liblist.gam ..\..\gearbox\liblist.gam
copy old_liblist.gam ..\..\gearbox\old_liblist.gam

echo.
copy HPB_bot.cfg ..\..\gearbox\HPB_bot.cfg
copy ..\HPB_bot_names.txt ..\..\gearbox\HPB_bot_names.txt
copy ..\HPB_bot_chat.txt ..\..\gearbox\HPB_bot_chat.txt

echo.
copy *.HPB_wpt ..\..\gearbox\maps

echo.
copy ..\HPB_bot.dll ..\..\gearbox\dlls
echo.
echo.
echo KURULUM ISLEMI BASARIYLA TAMAMLANDI
goto done

:not_installed
echo Opposing Force Kurulu Degil
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
