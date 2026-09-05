
#include <math.h>
#include <stdio.h>

__asm__(".symver pow, pow@GLIBC_2.2.5");
__asm__(".symver exp, exp@GLIBC_2.2.5");
__asm__(".symver log, log@GLIBC_2.2.5");
__asm__(".symver log2, log2@GLIBC_2.2.5");

int main() {
    printf("%f %f
", pow(2.0, 3.0), exp(1.0));
    return 0;
}
