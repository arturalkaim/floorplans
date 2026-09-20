plan "Casa T3" units:m walls 0.3/0.12 north 0

room suite "Suite parental" bedroom night rect 0,0 4.6x4.4
room wc_suite "WC suite" bath night rect 4.6,0 2.2x2.2
room closet "Closet" storage night rect 4.6,2.2 2.2x2.2
room quarto1 "Quarto 1" bedroom night rect 6.8,0 3.6x4.4
room quarto2 "Quarto 2" bedroom night rect 10.4,0 3.6x4.4
room wc_comum "WC comum" bath night rect 14,0 2.8x4.4
room distrib "Distribuidor" corridor night rect 4.6,4.4 12.2x1.4
room hall "Hall" hall day rect 0,4.4 4.6x3.6
room escritorio "Escritório" office work rect 0,8 4.6x2.6
room wc_social "WC social" wc day rect 4.6,5.8 2x2
room sala "Sala comum" living day poly 6.6,5.8 12,5.8 12,10.6 4.6,10.6 4.6,7.8 6.6,7.8
room cozinha "Cozinha" kitchen day poly 12,5.8 15,5.8 15,7.6 16.8,7.6 16.8,10.6 12,10.6
room despensa "Despensa" storage work rect 15,5.8 1.8x1.8
outdoor alpendre "Alpendre" covered rect 6.6,10.6 5.4x2.8

door hall @1.7 w1 hinge:end swing:hall entrance
door hall>wc_social @0.6 w0.8 hinge:end swing:wc_social
door hall>escritorio @1.6 w0.8 hinge:start swing:escritorio
door hall>suite @3.45 w0.9 hinge:end swing:suite
door suite>wc_suite @1 w0.8 hinge:end swing:wc_suite
door suite>closet @0.8 w0.8 hinge:end swing:closet
door distrib>quarto1 @1.05 w0.9 hinge:end swing:quarto1
door distrib>quarto2 @1.05 w0.9 hinge:end swing:quarto2
door distrib>wc_comum @1.05 w0.9 hinge:end swing:wc_comum
door despensa>cozinha @1 w0.8 on:despensa.south hinge:start swing:cozinha
cased hall>distrib w1.4
cased distrib>sala @1.2 w1.6
cased sala>cozinha @2 w1.6
window suite.north @2.3 w2.2
window quarto1 @1.9 w1.8
window quarto2 @1.9 w1.8
window wc_comum.north @1.5 w1
window sala @1 w1.2
window alpendre>sala @2.6 w3.6
window cozinha.south @2 w2
window escritorio.south @2.1 w2.2
window escritorio.west @1.3 w1.4
window despensa @0.9 w1
