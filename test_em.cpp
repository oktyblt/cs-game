#include <emscripten.h>
#include <stdio.h>
int main() {
    double ratio = EM_ASM_DOUBLE({ return window.innerWidth / window.innerHeight; });
    printf("ratio: %f\n", ratio);
    return 0;
}
