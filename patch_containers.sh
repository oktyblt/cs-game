for id in 27015 27016 27017 27018; do
  docker exec cs15-$id sed -i 's/\+port "${PORT:-27015}"/\+port "${PORT:-27015}" \+mp_consistency 0 \+sv_consistency 0/g' /opt/xashds/start.sh
  docker restart cs15-$id
done
