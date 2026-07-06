@echo off

echo.
if not exist ..\..\cstrike\nul goto not_installed
if not exist ..\..\cstrike\liblist.gam goto not_installed

if exist ..\..\cstrike\old_liblist.gam goto already_installed

echo Dosyalar kopyalaniyor
copy liblist.gam ..\..\cstrike\liblist.gam
copy old_liblist.gam ..\..\cstrike\old_liblist.gam

echo.
copy HPB_bot.cfg ..\..\cstrike\HPB_bot.cfg
copy ..\HPB_bot_names.txt ..\..\cstrike\HPB_bot_names.txt
copy ..\HPB_bot_chat.txt ..\..\cstrike\HPB_bot_chat.txt

echo.
copy *.HPB_wpt ..\..\cstrike\maps

echo.
echo DLL dosyalari kopyalaniyor
copy ..\HPB_bot.dll ..\..\cstrike\dlls
echo.
echo.
echo KURULUM ISLEMI BASARIYLA TAMAMLANDI
goto done

:not_installed
echo Counter-Strike Kurulu Degil
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
