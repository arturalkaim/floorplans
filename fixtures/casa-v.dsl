plan "Casa em V" units:m walls 0.3/0.12 north 0

room sala "Sala e cozinha" living day poly 7,12 15,12 19.677,14.7 15,22.799 7,22.799 2.323,14.7
room corr_w "Corredor poente" corridor night poly 7,12 2.3,3.859 1.088,4.559 5.788,12.7
room wc_w "Casa de banho" bath night poly 5.788,12.7 4.588,10.622 1.123,12.622 2.323,14.7
room quarto1 "Quarto 1" bedroom night poly 4.588,10.622 2.788,7.504 -0.677,9.504 1.123,12.622
room quarto2 "Quarto 2" bedroom night poly 2.788,7.504 1.088,4.559 -2.377,6.559 -0.677,9.504
room suite "Suite" bedroom night poly 2.3,3.859 0.2,0.222 -2.052,1.522 -1.152,3.081 -3.577,4.481 -2.377,6.559
room wc_suite "WC da suite" bath night poly -1.152,3.081 -2.052,1.522 -4.477,2.922 -3.577,4.481
room corr_e "Corredor nascente" corridor work poly 15,12 18.2,6.457 19.412,7.157 16.212,12.7
room lavandaria "Lavandaria" utility work poly 16.212,12.7 17.412,10.622 20.877,12.622 19.677,14.7
room escritorio "Escritório" office work poly 17.412,10.622 19.412,7.157 22.877,9.157 20.877,12.622
room brincar "Sala de brincar" living work poly 18.2,6.457 21,1.608 25.677,4.308 22.877,9.157
room garagem "Garagem" garage work poly 16.577,20.069 20.877,12.622 25.899,15.522 21.599,22.969
outdoor deck "Deck da piscina" poly 7,12 5,8.536 5,4 17,4 17,8.536 15,12
outdoor patio "Jardim" poly 0.2,0.222 5,8.536 5,4 17,4 17,8.536 21,1.608

door sala at 8.5,22.799 w1 swing:sala entrance
window sala at 12.5,22.799 w2.4
door sala>deck at 11,12 w8 glazed sliding
door sala>corr_w at 6.394,12.35 w0.9 swing:corr_w
door sala>corr_e at 15.606,12.35 w0.9 swing:corr_e
door corr_w>wc_w at 5.188,11.661 w0.8 swing:wc_w
door corr_w>quarto1 at 3.688,9.063 w0.9 swing:quarto1
door corr_w>quarto2 at 1.938,6.032 w0.9 swing:quarto2
door corr_w>suite at 1.694,4.209 w0.9 swing:suite
door suite>wc_suite at -2.364,3.781 w0.8 swing:wc_suite
door corr_w>patio at 4,6.804 w1 swing:patio glazed
door corr_e>lavandaria at 16.812,11.661 w0.8 swing:lavandaria
door corr_e>escritorio at 18.412,8.889 w0.9 swing:escritorio
door corr_e>brincar at 18.806,6.807 w1 swing:brincar
door corr_e>patio at 17.75,7.237 w1 swing:patio glazed
door garagem at 19.088,21.519 w5 sliding
door garagem>lavandaria at 20.277,13.661 w0.9 swing:lavandaria
window wc_w at 1.723,13.661 w0.6
window quarto1 at 0.223,11.063 w1.2
window quarto2 at -1.527,8.032 w1.2
window suite at -2.977,5.52 w1.6
window suite at -0.926,0.872 w1.2
window wc_suite at -3.264,2.222 w0.6
window garagem at 23.699,19.332 w1.2
window escritorio at 21.877,10.889 w1.4
window brincar at 24.277,6.733 w1.6
window brincar at 23.338,2.958 w1.4

fixture pool in:deck at 6,5 size 10x4
fixture counter in:sala at 10.3,22.049 size 4.55x0.6 "Bancada"
fixture island in:sala at 10.9,19.399 size 2.4x1 "Ilha"
