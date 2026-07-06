@echo off

echo.
if not exist ..\..\valve\nul goto not_installed
if not exist ..\..\valve\liblist.gam goto not_installed

if exist ..\..\valve\old_liblist.gam goto already_installed

echo Dosyalar Kopyalaniyor
copy liblist.gam ..\..\valve\liblist.gam
copy old_liblist.gam ..\..\valve\old_liblist.gam

echo.
copy HPB_bot.cfg ..\..\valve\HPB_bot.cfg
copy ..\HPB_bot_names.txt ..\..\valve\HPB_bot_names.txt
copy ..\HPB_bot_chat.txt ..\..\valve\HPB_bot_chat.txt

echo.
copy *.HPB_wpt ..\..\valve\maps

echo.
copy ..\HPB_bot.dll ..\..\valve\dlls
echo.
echo.
echo KURULUM ISLEMI BASARIYLA TAMAMLANDI
goto done

:not_installed
echo Half-Life Kurulu Degil
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
