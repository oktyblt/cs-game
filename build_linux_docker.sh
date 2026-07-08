#!/bin/bash
docker run --rm -v /Users/oktaybulut/Desktop/Hlf/cs-web-game/wasm_build/webxash3d-fwgs/packages/cs16-client/cs16-client/3rdparty/ReGameDLL_CS:/source \
  -e DEBIAN_FRONTEND=noninteractive i386/debian:bullseye bash -c "apt-get update && apt-get install -y cmake gcc g++ build-essential tzdata && cd /source && rm -rf build_linux && mkdir -p build_linux && cd build_linux && cmake .. -DCMAKE_BUILD_TYPE=Release && make -j4"
