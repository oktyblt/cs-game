@echo off

echo.
if not exist ..\..\tfc\nul goto not_installed
if not exist ..\..\tfc\liblist.gam goto not_installed

if exist ..\..\tfc\old_liblist.gam goto already_installed

echo Dosyalar Kopyalaniyor
copy liblist.gam ..\..\tfc\liblist.gam
copy old_liblist.gam ..\..\tfc\old_liblist.gam

echo.
copy HPB_bot.cfg ..\..\tfc\HPB_bot.cfg
copy ..\HPB_bot_names.txt ..\..\tfc\HPB_bot_names.txt
copy ..\HPB_bot_chat.txt ..\..\tfc\HPB_bot_chat.txt

echo.
copy *.HPB_wpt ..\..\tfc\maps

echo.
copy ..\HPB_bot.dll ..\..\tfc\dlls
echo.
echo.
echo KURULUM ISLEMI BASARIYLA TAMAMLANDI
goto done

:not_installed
echo Team Fortress Kurulu Degil
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
