plan "Casa em V" units:m walls 0.3/0.12 north 0

room sala "Sala" living day poly 7,12 11,12 11,17 3.651,17 2.323,14.7
room cozinha "Cozinha" kitchen day poly 11,12 15,12 19.677,14.7 18.349,17 11,17
room corr_w "Corredor poente" corridor night poly 7,12 2.3,3.859 1.088,4.559 5.788,12.7
room wc_w "Casa de banho" bath night poly 5.788,12.7 4.588,10.622 1.123,12.622 2.323,14.7
room quarto1 "Quarto 1" bedroom night poly 4.588,10.622 2.788,7.504 -0.677,9.504 1.123,12.622
room quarto2 "Quarto 2" bedroom night poly 2.788,7.504 1.088,4.559 -2.377,6.559 -0.677,9.504
room suite "Suite" bedroom night poly 2.3,3.859 0.2,0.222 -4.477,2.922 -2.377,6.559
room corr_e "Corredor nascente" corridor work poly 15,12 18.2,6.457 19.412,7.157 16.212,12.7
room lavandaria "Lavandaria" utility work poly 16.212,12.7 17.412,10.622 20.877,12.622 19.677,14.7
room escritorio "Escritório" office work poly 17.412,10.622 19.412,7.157 22.877,9.157 20.877,12.622
room brincar "Sala de brincar" living work poly 18.2,6.457 21,1.608 25.677,4.308 22.877,9.157
outdoor patio "Pátio da piscina" poly 0.2,0.222 7,12 15,12 21,1.608

door sala at 9,17 w1 swing:sala entrance
cased sala>cozinha at 11,14.5 w1.6
door cozinha>patio at 13,12 w1.2 swing:patio glazed
door sala>corr_w at 6.394,12.35 w0.9 swing:corr_w
door cozinha>corr_e at 15.606,12.35 w0.9 swing:corr_e
door corr_w>wc_w at 5.188,11.661 w0.8 swing:wc_w
door corr_w>quarto1 at 3.688,9.063 w0.9 swing:quarto1
door corr_w>quarto2 at 1.938,6.032 w0.9 swing:quarto2
door corr_w>suite at 1.694,4.209 w0.9 swing:suite
door corr_w>patio at 4.5,7.67 w1 swing:patio glazed
door corr_e>lavandaria at 16.812,11.661 w0.8 swing:lavandaria
door corr_e>escritorio at 18.412,8.889 w0.9 swing:escritorio
door corr_e>brincar at 18.806,6.807 w1 swing:brincar
door corr_e>patio at 17,8.536 w1 swing:patio glazed
window sala at 6.5,17 w1.8
window cozinha at 14.5,17 w1.4
window wc_w at 1.723,13.661 w0.6
window quarto1 at 0.223,11.063 w1.2
window quarto2 at -1.527,8.032 w1.2
window suite at -3.427,4.741 w1.6
window suite at -2.138,1.572 w1.2
window lavandaria at 20.277,13.661 w0.6
window escritorio at 21.877,10.889 w1.4
window brincar at 24.277,6.733 w1.6
window brincar at 23.338,2.958 w1.4

fixture pool in:patio at 8,6 size 6x3
