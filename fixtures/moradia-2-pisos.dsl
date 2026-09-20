plan "Moradia de 2 pisos" walls 0.3/0.12 stack piso0,piso1
grid cols 4.9,1.2,1.3,4.4 rows 1.4,1.8,2,2,1,1.8

level piso0 "Piso 0" h2.7 ground

room hall "Hall" hall day rect 4.9,0 2.5x5.2
room sala "Sala" living day rect 0,0 4.9x5.2
room cozinha "Cozinha" kitchen day rect 7.4,0 4.4x5.2
room escritorio "Escritório" office day rect 0,5.2 4.9x4.8
room wc "WC de serviço" wc day rect 4.9,5.2 2.5x2
outdoor alpendre "Alpendre" covered poly 4.9,7.2 7.4,7.2 7.4,5.2 11.8,5.2 11.8,10 4.9,10

door hall.north @-0.7 w1 hinge:end swing:hall entrance
door hall>sala w0.9 swing:sala
door hall>cozinha w0.9 swing:cozinha
door hall>wc w0.8 swing:wc
door sala>escritorio w0.9 swing:escritorio
door cozinha>alpendre w0.9 swing:cozinha
window sala.west w2.4
window cozinha.east w1.8
window escritorio.west w1.6
window alpendre>wc w0.8 on:wc.south

fixture sink in:cozinha at 7.7,0.3 size 3.8x0.6
fixture wc in:wc at 5.2,5.5 size 0.4x0.7

level piso1 "Piso 1" h2.6

room hall_sup "Hall superior" hall night
room quarto1 "Quarto 1" bedroom night
room quarto2 "Quarto 2" bedroom night
room quarto3 "Quarto 3" bedroom night
room wc_suite "WC da suite" bath night
room wc_sup "WC superior" bath night
void vazio_sala "Pé-direito duplo da Sala"
void vazio_escada "Caixa de escada"

layout
  quarto1 hall_sup     hall_sup quarto2
  quarto1 vazio_escada hall_sup quarto2
  vazio_sala vazio_escada hall_sup wc_suite
  quarto3 hall_sup     hall_sup .
  quarto3 .            .        .
  wc_sup  .            .        .

door hall_sup>quarto1 w0.8 swing:quarto1
door hall_sup>quarto2 w0.8 swing:quarto2
door hall_sup>quarto3 w0.8 swing:quarto3
door hall_sup>wc_suite w0.7 swing:wc_suite
door quarto3>wc_sup w0.7 swing:wc_sup
window quarto1.north w2
window quarto2.north w1.8
window quarto3.west w1.6
window wc_suite.east w0.9
window wc_sup.south w0.8

fixture bath in:wc_suite at 9.9,3.5 size 1.7x0.75
fixture shower in:wc_sup at 0.3,8.5 size 0.9x0.9

stairs escada "Escada" up:0 risers:15
  at piso0 in:hall rect 4.95,0.2 1.1x3.64
  at piso1 in:hall_sup rect 4.95,0.2 1.1x1.1
