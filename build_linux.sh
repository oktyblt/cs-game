#!/bin/bash
cd /Users/oktaybulut/Desktop/Hlf/cs-web-game/wasm_build/webxash3d-fwgs/packages/cs16-client/cs16-client/3rdparty/ReGameDLL_CS/
mkdir -p build_linux
cd build_linux
cmake .. -DCMAKE_TOOLCHAIN_FILE=../cmake/Toolchain-Linux-x86.cmake -DCMAKE_BUILD_TYPE=Release
make -j4
